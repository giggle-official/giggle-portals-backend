import { BadRequestException, forwardRef, Inject, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    CreateMarketMakerDto,
    IpDelegationDto,
    IpDelegationQueryDto,
    IpDelegationResponseDto,
    LaunchIpTokenByMarketMakerDto,
} from "./market-maker.dto"
import { ip_library, ip_token_delegation, ip_token_delegation_status, users } from "@prisma/client"
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

        const ipDelegations = await this.prismaService.ip_token_delegation.findMany({
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
            //todo: add market maker filter
        })

        return {
            data: ipDelegations.map(this.mapIpDelegation),
            total: total,
        }
    }

    mapIpDelegation(
        ipDelegation: ip_token_delegation & { ip_info: ip_library & { user_info: users } },
    ): IpDelegationDto {
        return {
            id: ipDelegation.id,
            ip_name: ipDelegation.ip_info?.name,
            ip_ticker: ipDelegation.ip_info?.ticker,
            ip_id: ipDelegation.ip_info?.id,
            owner: ipDelegation.ip_info?.user_info?.email,
            status: ipDelegation.status as ip_token_delegation_status,
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

        await this.prismaService.market_makers.create({
            data: {
                user: user.username_in_be,
            },
        })

        return {
            message: "Market maker created successfully",
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
