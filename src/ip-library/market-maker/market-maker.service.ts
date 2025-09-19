import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    AllIpDelegationsQueryDto,
    AllocateDelegationToMarketMakerDto,
    CancelIpDelegationDto,
    CreateMarketMakerDto,
    DeleteMarketMakerDto,
    IpDelegationDto,
    IpDelegationQueryDto,
    IpDelegationResponseDto,
    LaunchIpTokenByMarketMakerDto,
} from "./market-maker.dto"
import {
    ip_library,
    ip_token_delegation,
    ip_token_delegation_status,
    market_makers,
    Prisma,
    users,
} from "@prisma/client"
import { Observable } from "rxjs"
import { SSEMessage } from "src/web3/giggle/giggle.dto"
import { IpLibraryService } from "../ip-library.service"

@Injectable()
export class MarketMakerService {
    constructor(
        private readonly prismaService: PrismaService,

        @Inject(forwardRef(() => IpLibraryService))
        private readonly ipLibraryService: IpLibraryService,
    ) {}

    async getInfo(user: UserJwtExtractDto) {
        const info = await this.prismaService.market_makers.findFirst({
            where: {
                user: user.usernameShorted,
            },
        })

        return {
            is_market_maker: !!info,
            info,
        }
    }

    async getIpDelegation(user: UserJwtExtractDto, query: IpDelegationQueryDto): Promise<IpDelegationResponseDto> {
        //check user is market maker
        const isMarketMaker = await this.getInfo(user)

        if (!isMarketMaker.is_market_maker) {
            throw new BadRequestException("User is not a market maker")
        }

        const where: Prisma.ip_token_delegationWhereInput = {
            market_maker: user.usernameShorted,
        }

        const ipDelegations = await this.prismaService.ip_token_delegation.findMany({
            where,
            include: {
                ip_info: {
                    include: {
                        user_info: true,
                    },
                },
            },
            skip: Math.max(0, parseInt(query.page.toString()) - 1) * Math.max(0, parseInt(query.page_size.toString())),
            take: Math.max(0, parseInt(query.page_size.toString()) || 10),
        })

        const total = await this.prismaService.ip_token_delegation.count({
            where,
        })

        return {
            data: ipDelegations.map(this.mapIpDelegation),
            total: total,
        }
    }
    async getAllDelegations(query: AllIpDelegationsQueryDto): Promise<IpDelegationResponseDto> {
        const where: Prisma.ip_token_delegationWhereInput = {
            status: query?.status || undefined,
            market_maker: query?.market_maker === "" ? null : query?.market_maker || undefined,
        }

        const ipDelegations = await this.prismaService.ip_token_delegation.findMany({
            where,
            include: {
                ip_info: {
                    include: {
                        user_info: true,
                    },
                },
                market_maker_info: true,
            },
            skip: Math.max(0, parseInt(query.page.toString()) - 1) * Math.max(0, parseInt(query.page_size.toString())),
            take: Math.max(0, parseInt(query.page_size.toString()) || 10),
        })

        const total = await this.prismaService.ip_token_delegation.count({
            where,
        })

        return {
            data: ipDelegations.map(this.mapIpDelegation),
            total: total,
        }
    }

    async allocateDelegationToMarketMaker(body: AllocateDelegationToMarketMakerDto): Promise<IpDelegationDto> {
        const delegation = await this.prismaService.ip_token_delegation.findUnique({
            where: { id: body.delegation_id },
        })
        if (!delegation) {
            throw new BadRequestException("Delegation not found")
        }

        if (delegation.status !== "pending") {
            throw new BadRequestException("Delegation is not pending")
        }

        const marketMaker = await this.prismaService.market_makers.findUnique({
            where: { id: body.market_maker_id },
        })
        if (!marketMaker) {
            throw new BadRequestException("Market maker not found")
        }

        await this.prismaService.ip_token_delegation.update({
            where: { id: body.delegation_id },
            data: {
                market_maker: marketMaker.user,
            },
        })

        const ipDelegation = await this.prismaService.ip_token_delegation.findUnique({
            where: { id: body.delegation_id },
            include: {
                ip_info: {
                    include: {
                        user_info: true,
                    },
                },
                market_maker_info: true,
            },
        })

        return this.mapIpDelegation(ipDelegation)
    }

    mapIpDelegation(
        ipDelegation: ip_token_delegation & { ip_info: ip_library & { user_info: users } } & {
            market_maker_info: market_makers
        },
    ): IpDelegationDto {
        return {
            id: ipDelegation.id,
            ip_name: ipDelegation.ip_info?.name,
            ip_ticker: ipDelegation.ip_info?.ticker,
            ip_id: ipDelegation.ip_info?.id,
            owner: ipDelegation.ip_info?.user_info?.email,
            status: ipDelegation.status as ip_token_delegation_status,
            market_maker_info: {
                id: ipDelegation.market_maker_info?.id,
                nickname: ipDelegation.market_maker_info?.nickname,
            },
            created_at: ipDelegation.created_at,
            updated_at: ipDelegation.updated_at,
        }
    }

    async create(body: CreateMarketMakerDto) {
        const user = await this.prismaService.users.findUnique({
            where: {
                email: body.email,
            },
        })
        if (!user) {
            throw new NotFoundException("User not found")
        }

        const isExist = await this.prismaService.market_makers.findFirst({
            where: {
                user_info: {
                    username_in_be: user.username_in_be,
                },
            },
        })
        if (isExist) {
            throw new BadRequestException("Market maker already exists")
        }

        await this.prismaService.$transaction(async (tx) => {
            await tx.market_makers.create({
                data: {
                    user: user.username_in_be,
                    email: body.email,
                    nickname: body.nickname,
                },
            })
            await tx.users.update({
                where: {
                    username_in_be: user.username_in_be,
                },
                data: {
                    can_launch_by_agent: true,
                },
            })
        })

        return {
            message: "Market maker created successfully",
        }
    }

    async cancelIpDelegation(user: UserJwtExtractDto, body: CancelIpDelegationDto) {
        const isExist = await this.prismaService.ip_token_delegation.findFirst({
            where: {
                id: body.delegation_id,
                status: ip_token_delegation_status.pending,
                market_maker: user.usernameShorted,
            },
        })

        if (!isExist) {
            throw new BadRequestException("Ip delegation not found or not pending")
        }

        await this.prismaService.$transaction(async (tx) => {
            await tx.ip_token_delegation.update({
                where: { id: body.delegation_id },
                data: { status: ip_token_delegation_status.cancelled },
            })
            await tx.ip_library.update({
                where: { id: isExist.ip_id },
                data: {
                    token_is_delegating: false,
                },
            })
        })
    }

    async getMarketMakerList() {
        return this.prismaService.market_makers.findMany({
            select: {
                id: true,
                nickname: true,
            },
        })
    }

    async getMarketMakersByAdmin() {
        return this.prismaService.market_makers.findMany()
    }

    async delete(body: DeleteMarketMakerDto) {
        const isExist = await this.prismaService.market_makers.findFirst({
            where: {
                email: body.email,
            },
        })

        if (!isExist) {
            throw new NotFoundException("Market maker not found")
        }

        const isExistIpDelegation = await this.prismaService.ip_token_delegation.findFirst({
            where: {
                market_maker: isExist.user,
                status: ip_token_delegation_status.pending,
            },
        })

        if (isExistIpDelegation) {
            throw new BadRequestException("Market maker has pending ip delegation, can not delete")
        }

        await this.prismaService.market_makers.deleteMany({
            where: {
                email: body.email,
            },
        })

        return {
            message: "Market maker deleted successfully",
        }
    }

    async completeDelegation(delegationId: number, user: UserJwtExtractDto) {
        if (!delegationId) return
        await this.prismaService.$transaction(async (tx) => {
            const delegationInfo = await tx.ip_token_delegation.update({
                where: { id: delegationId },
                data: {
                    status: ip_token_delegation_status.completed,
                    market_maker: user.usernameShorted,
                },
            })
            await tx.ip_library.update({
                where: { id: delegationInfo.ip_id },
                data: {
                    token_is_delegating: false,
                },
            })
        })
    }

    launchIpToken(user: UserJwtExtractDto, body: LaunchIpTokenByMarketMakerDto): Observable<SSEMessage> {
        return new Observable((subscriber) => {
            this.ipLibraryService
                .processLaunchIpToken(
                    user,
                    { ip_id: body.ip_id, purchase_strategy: body.purchase_strategy },
                    subscriber,
                    {
                        market_maker: user.usernameShorted,
                        delegation_id: body.delegation_id,
                    },
                )
                .catch((error) => {
                    subscriber.error(error)
                })
        })
    }
}
