import { BadRequestException, Injectable, NotFoundException, Logger } from "@nestjs/common"
import { CreateIpDto, CreateIpOrderDto } from "../ip-library.dto"
import { UserJwtExtractDto } from "src/user/user.controller"
import { PrismaService } from "src/common/prisma.service"
import { CreateOrderDto, OrderDetailDto, OrderStatus } from "src/payment/order/order.dto"
import { OrderService } from "src/payment/order/order.service"
import { IpLibraryService } from "../ip-library.service"
import { AssetsService } from "src/assets/assets.service"
import { CheckIpOrderDto, CheckIpOrderListDto, IpCreateStatus, OrderRanksResponseDto } from "./ip-order.dto"
import { Cron, CronExpression } from "@nestjs/schedule"
import { lastValueFrom, Observable, take, tap, toArray } from "rxjs"
import { SSEMessage } from "src/web3/giggle/giggle.dto"
import { UserService } from "src/user/user.service"
import { third_level_ip_orders } from "@prisma/client"
import { UtilitiesService } from "src/common/utilities.service"
@Injectable()
export class IpOrderService {
    private readonly logger = new Logger(IpOrderService.name)
    constructor(
        private readonly prisma: PrismaService,
        private readonly orderService: OrderService,
        private readonly ipLibraryService: IpLibraryService,
        private readonly assetsService: AssetsService,
        private readonly userService: UserService,
    ) {}

    async createIpOrder(user: UserJwtExtractDto, body: CreateIpOrderDto, app_id: string): Promise<OrderDetailDto> {
        //name
        if (!app_id) {
            throw new BadRequestException("app_id is required")
        }

        //exists

        const exists = await this.prisma.ip_library.findFirst({
            where: {
                name: body.name,
                NOT: {
                    owner: user.usernameShorted,
                },
            },
        })
        if (exists) {
            throw new BadRequestException("ip name already exists")
        }

        if (!(await this.isThirdLevelIp(body))) {
            throw new BadRequestException("request ip is not a 3rd level ip")
        }

        //check if ip name exists in pending orders
        const pendingOrder = await this.prisma.third_level_ip_orders.findFirst({
            where: {
                owner: user.usernameShorted,
                current_status: OrderStatus.PENDING,
                creation_data: {
                    path: "$.name",
                    equals: body.name,
                },
            },
        })
        if (pendingOrder) {
            throw new BadRequestException("ip name already exists in pending orders")
        }

        if (body.share_to_giggle) {
            throw new BadRequestException("share_to_giggle is not allowed for 3rd level ip")
        }
        const parentIp = await this.ipLibraryService.detail(body.parent_ip_library_id.toString(), null, null, user)
        if (!parentIp) {
            throw new BadRequestException("parent ip not found")
        }

        //find top level ip
        const topLevelIp = await this.prisma.ip_library_child.findFirst({
            where: {
                ip_id: body.parent_ip_library_id,
            },
            select: {
                parent_ip: true,
            },
        })
        if (!topLevelIp) {
            throw new BadRequestException("top level ip not found")
        }

        let amount = 1
        let duration = 1
        if (!body.video_id) {
            amount = parentIp.authorization_settings.license_price
            duration = 1
        } else {
            const asset = await this.assetsService.getAsset(user, body.video_id)
            if (!asset || asset.type !== "video") {
                throw new BadRequestException("asset not found or is not a video")
            }
            duration = Math.ceil(asset?.asset_info?.videoInfo?.duration / 60)
            amount = duration * parentIp.authorization_settings.license_price
        }

        if (amount < parentIp.authorization_settings.license_price) {
            throw new BadRequestException("get video duration failed, please try again later")
        }

        const orderInfo: CreateOrderDto = {
            amount: amount * 100,
            description: `Create Derivative Ip For ${parentIp.name}`,
            redirect_url: body.redirect_url,
            callback_url: `${process.env.FRONTEND_URL}/api/v1/ip/order/callback`,
        }
        const orderDetail = await this.orderService.createOrder(orderInfo, user, app_id)

        //record ip order
        await this.prisma.third_level_ip_orders.create({
            data: {
                order_id: orderDetail.order_id,
                creation_data: body as any,
                top_level_ip: topLevelIp.parent_ip,
                duration: duration,
                current_status: orderDetail.current_status,
                owner: orderDetail.owner,
                ip_create_status: IpCreateStatus.PENDING,
            },
        })
        return orderDetail
    }

    async ipOrderDetail(order_id: string, user: UserJwtExtractDto): Promise<CheckIpOrderDto> {
        const order = await this.prisma.third_level_ip_orders.findFirst({
            where: {
                order_id: order_id,
                owner: user.usernameShorted,
            },
        })
        if (!order) {
            throw new NotFoundException("Order not found")
        }

        const orderInfo = await this.orderService.getOrderDetail(order.order_id, user)
        return {
            order_id: order.id.toString(),
            creation_data: order.creation_data as any as CreateIpDto,
            ip_create_status: order.ip_create_status as IpCreateStatus,
            order_info: orderInfo,
        }
    }

    async getIpOrderList(user: UserJwtExtractDto, app_id: string): Promise<CheckIpOrderListDto> {
        if (!app_id) {
            throw new BadRequestException("app_id is required")
        }
        const orders = await this.prisma.third_level_ip_orders.findMany({
            where: {
                owner: user.usernameShorted,
                current_status: {
                    not: OrderStatus.PENDING,
                },
                order_info: {
                    app_id: app_id,
                },
            },
            orderBy: {
                created_at: "desc",
            },
        })

        return {
            total: orders.length,
            orders: await Promise.all(
                orders.map(async (order) => {
                    const orderInfo = await this.orderService.getOrderDetail(order.order_id, user)
                    return {
                        order_id: order.id.toString(),
                        creation_data: order.creation_data as any as CreateIpDto,
                        ip_create_status: order.ip_create_status as IpCreateStatus,
                        order_info: orderInfo,
                    }
                }),
            ),
        }
    }

    async getOrderRanks(app_id: string): Promise<OrderRanksResponseDto[]> {
        const appBindIp = await this.prisma.app_bind_ips.findFirst({
            where: {
                app_id: app_id,
            },
        })
        if (!appBindIp) {
            throw new BadRequestException("app not found")
        }
        const topLevelIpId = appBindIp.ip_id
        const ipLibraries = await this.prisma.third_level_ip_orders.groupBy({
            by: ["owner"],
            _sum: {
                duration: true,
            },
            where: {
                top_level_ip: topLevelIpId,
                ip_create_status: IpCreateStatus.CREATED,
                current_status: { in: [OrderStatus.COMPLETED, OrderStatus.REWARDS_RELEASED] },
            },
            orderBy: {
                _sum: {
                    duration: "desc",
                },
            },
        })

        const users = await this.prisma.users.findMany({
            where: {
                username_in_be: { in: ipLibraries.map((ip) => ip.owner) },
            },
            select: {
                username_in_be: true,
                username: true,
                avatar: true,
            },
        })

        return ipLibraries.map((ip, index) => ({
            username: users.find((u) => u.username_in_be === ip.owner)?.username || "",
            avatar: users.find((u) => u.username_in_be === ip.owner)?.avatar || "",
            duration: ip._sum.duration || 0,
            rank: index + 1,
        }))
    }
    async orderCallback(body: OrderDetailDto) {
        const previousOrder = await this.prisma.third_level_ip_orders.findFirst({
            where: {
                order_id: body.order_id,
                current_status: OrderStatus.PENDING,
            },
        })
        if (!previousOrder) {
            return
        }
        if (body.current_status === previousOrder.current_status) {
            return
        }
        await this.prisma.third_level_ip_orders.update({
            where: {
                id: previousOrder.id,
            },
            data: {
                current_status: body.current_status,
            },
        })
    }

    //check ip order if order completed, but status pending
    @Cron(CronExpression.EVERY_10_SECONDS)
    async checkIpOrder() {
        const taskId = 2
        const maxRetryCount = 3
        //sleep a random time but less than 2 seconds
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 2000))

        //check if task running
        const taskRunning = await UtilitiesService.checkTaskRunning(taskId)
        if (taskRunning) {
            this.logger.warn("task running, skip checkIpOrder")
            return
        }

        try {
            //set is_requesting to true
            await UtilitiesService.startTask(taskId)
            //check order status and update to ip order status
            const pendingOrders = await this.prisma.third_level_ip_orders.findMany({
                where: {
                    current_status: OrderStatus.PENDING,
                },
            })

            if (pendingOrders.length > 0) {
                for (const order of pendingOrders) {
                    const currentOrder = await this.prisma.orders.findUnique({
                        where: {
                            order_id: order.order_id,
                            current_status: {
                                in: [OrderStatus.COMPLETED, OrderStatus.REWARDS_RELEASED],
                            },
                        },
                    })
                    if (currentOrder) {
                        await this.prisma.third_level_ip_orders.update({
                            where: { id: order.id },
                            data: {
                                current_status: OrderStatus.COMPLETED,
                            },
                        })
                    }
                }
            }

            //get order
            let order: third_level_ip_orders | null = null

            order = await this.prisma.third_level_ip_orders.findFirst({
                where: {
                    ip_create_status: IpCreateStatus.PENDING,
                    current_status: {
                        in: [OrderStatus.COMPLETED, OrderStatus.REWARDS_RELEASED],
                    },
                }, //the order is completed, but status is pending
            })
            if (!order) {
                //pick a failed order
                order = await this.prisma.third_level_ip_orders.findFirst({
                    where: {
                        ip_create_status: IpCreateStatus.FAILED,
                        retry_count: {
                            lt: maxRetryCount,
                        },
                    },
                })
            }

            if (!order) {
                await UtilitiesService.stopTask(taskId)
                return
            }

            //create ip
            const user = await this.userService.getProfile({ usernameShorted: order.owner })
            if (!user) {
                await UtilitiesService.stopTask(taskId)
                return
            }

            this.logger.warn("processOrder", order)
            //set status to creating
            await this.prisma.third_level_ip_orders.update({
                where: { id: order.id },
                data: {
                    ip_create_status: IpCreateStatus.CREATING,
                },
            })

            try {
                const result = new Observable<SSEMessage>((subscriber) => {
                    this.ipLibraryService
                        .processCreateIp(user, order.creation_data as any as CreateIpDto, subscriber)
                        .catch((error) => {
                            subscriber.error(error)
                        })
                })
                let allResponse = []
                const response = await lastValueFrom(
                    result.pipe(
                        tap((message) => {
                            allResponse.push(message.data)
                        }),
                        toArray(),
                    ),
                )
                this.logger.warn("processOrder finished", order)
                //set status to created
                await this.prisma.third_level_ip_orders.update({
                    where: { id: order.id },
                    data: {
                        ip_create_status: IpCreateStatus.CREATED,
                        ip_create_response: JSON.stringify(response),
                    },
                })
            } catch (error) {
                this.logger.error("processOrder error", error)
                await this.prisma.third_level_ip_orders.update({
                    where: { id: order.id },
                    data: {
                        ip_create_status: IpCreateStatus.FAILED,
                        ip_create_response: JSON.stringify({ error: error }),
                        retry_count: order.retry_count + 1,
                    },
                })
            }
        } catch (error) {
            this.logger.error("checkIpOrder error", error)
        } finally {
            await UtilitiesService.stopTask(taskId)
        }
    }

    async isThirdLevelIp(creationData: CreateIpDto): Promise<boolean> {
        if (!creationData.parent_ip_library_id) {
            return false
        }

        const parentIpInfo = await this.prisma.ip_library.findUnique({
            where: { id: creationData.parent_ip_library_id },
        })
        if (!parentIpInfo) {
            return false
        }

        return !!(await this.prisma.ip_library_child.findFirst({
            where: { ip_id: creationData.parent_ip_library_id },
        }))
    }
}
