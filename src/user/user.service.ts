import {
    BadRequestException,
    forwardRef,
    Inject,
    Injectable,
    InternalServerErrorException,
    UnauthorizedException,
    Logger,
} from "@nestjs/common"
import {
    UserInfoDTO,
    ResetPasswordDto,
    CheckResetPasswordTokenDto,
    SubmitResetPasswordDto,
    BindEmailReqDto,
    UpdateProfileReqDto,
    RegisterInfoDTO,
    UserJwtExtractDto,
    CreateUserDto,
} from "./user.controller"
import { PrismaService } from "src/common/prisma.service"
import * as crypto from "crypto"
import { isEmail } from "class-validator"
import validator from "validator"
import { NotificationService } from "src/notification/notification.service"
import {
    ClaimRewardsDto,
    ClaimRewardsHistoryListDto,
    ClaimRewardsQueryDto,
    ClaimStatus,
    ContactDTO,
    InvitationsDetailDto,
    LoginCodeReqDto,
    UserTokenRewardsListDto,
    UserTokenRewardsQueryDto,
} from "./user.dto"
import { UtilitiesService } from "src/common/utilities.service"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { UserWalletDetailDto } from "./user.dto"
import { Prisma } from "@prisma/client"
import { LinkService } from "src/open-app/link/link.service"
import { LinkDetailDto } from "src/open-app/link/link.dto"
import * as fs from "fs"
import sharp from "sharp"
import { CreditService } from "src/payment/credit/credit.service"
import { Decimal } from "@prisma/client/runtime/library"

@Injectable()
export class UserService {
    private readonly logger = new Logger(UserService.name)
    constructor(
        private prisma: PrismaService,
        private readonly notificationService: NotificationService,

        @Inject(forwardRef(() => GiggleService))
        private readonly giggleService: GiggleService,

        @Inject(forwardRef(() => LinkService))
        private readonly linkService: LinkService,

        @Inject(forwardRef(() => UtilitiesService))
        private readonly utilitiesService: UtilitiesService,

        @Inject(forwardRef(() => CreditService))
        private readonly creditService: CreditService,
    ) {}

    async getUserInfoByEmail(email: string, app_id?: string): Promise<UserInfoDTO> {
        const record = await this.prisma.users.findFirst({
            where: {
                email: email,
            },
        })

        if (!record) {
            return null
        }

        return this.mapUserInfo(record)
    }

    async getUserInfoByUsernameShorted(userNameShorted: string): Promise<UserInfoDTO> {
        const record = await this.prisma.users.findFirst({
            where: {
                username_in_be: userNameShorted,
            },
        })

        if (!record) {
            return null
        }

        return this.mapUserInfo(record)
    }

    async createUser(userInfo: CreateUserDto): Promise<CreateUserDto> {
        const record = await this.prisma.users.findFirst({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (record) {
            throw new BadRequestException("user already exists, please sign in directly")
        }

        const data: Prisma.usersCreateInput = {
            username: userInfo.username,
            password: UserService.cryptoString(userInfo.password),
            email: userInfo.email,
            username_in_be: userInfo.usernameShorted,
            email_confirmed: false,
            current_plan: "Free",
            agent_user: UtilitiesService.generateRandomApiKey(),
            from_source_link: userInfo.from_source_link,
            from_device_id: userInfo.from_device_id,
            register_app_id: userInfo.app_id,
            invited_by: userInfo.invited_by || "",
            can_create_ip: !!userInfo.can_create_ip,
        }

        await this.prisma.users.create({
            data: data,
        })

        //bind giggle wallet
        await this.giggleService.bindGiggleWallet(userInfo.email)
        return userInfo
    }

    async getProfile(userInfo: UserJwtExtractDto): Promise<UserInfoDTO> {
        if (!userInfo.usernameShorted) {
            throw new UnauthorizedException("user not exists")
        }
        const _userInfoFromDb = await this.getUserInfoByUsernameShorted(userInfo.usernameShorted)
        if (!_userInfoFromDb) {
            throw new UnauthorizedException("user not exists")
        }

        const salsAgent = await this.prisma.sales_agent.findFirst({
            where: {
                user: userInfo.usernameShorted,
            },
        })

        const balanceInfo = await this.creditService.getUserCredits(userInfo.usernameShorted)
        const result: UserInfoDTO = {
            user_id: _userInfoFromDb.usernameShorted,
            username: _userInfoFromDb.username,
            usernameShorted: _userInfoFromDb.usernameShorted,
            email: _userInfoFromDb.email,
            emailConfirmed: _userInfoFromDb.emailConfirmed,
            avatar: _userInfoFromDb.avatar,
            description: _userInfoFromDb.description,
            followers: _userInfoFromDb.followers,
            following: _userInfoFromDb.following,
            can_create_ip: _userInfoFromDb.can_create_ip,
            permissions: ["all"],
            widget_info: null,
            device_id: userInfo?.device_id,
            is_developer: _userInfoFromDb?.is_developer,
            register_info: await this.getRegisterInfo(userInfo),
            phone_number: _userInfoFromDb.phone_number,
            phone_national: _userInfoFromDb.phone_national,
            current_credit_balance: balanceInfo.total_credit_balance,
            free_credit_balance: balanceInfo.free_credit_balance,
            wallet_address: _userInfoFromDb.wallet_address,
            is_sale_agent: !!salsAgent,
        }

        //if widget session is setting, we need to get the widget info
        if (userInfo?.widget_session_id) {
            const widgetSession = await this.prisma.widget_sessions.findUnique({
                where: { session_id: userInfo.widget_session_id },
            })
            if (!widgetSession) {
                throw new UnauthorizedException("invalid widget session")
            }
            result.widget_info = {
                widget_tag: widgetSession.widget_tag,
                app_id: widgetSession.app_id,
                user_subscribed: widgetSession.user_subscribed_widget,
            }
            result.permissions = widgetSession.permission as any
        } else if (userInfo?.app_id) {
            //if app_id is provided, we need find app bind widget info
            const appBindWidget = await this.prisma.app_bind_widgets.findFirst({
                where: {
                    app_id: userInfo.app_id,
                    enabled: true,
                    widget_tag: {
                        not: "login_from_external",
                    },
                },
            })
            if (appBindWidget) {
                const userSubscribed = await this.prisma.user_subscribed_widgets.findFirst({
                    where: {
                        user: userInfo.usernameShorted,
                        widget_tag: appBindWidget.widget_tag,
                    },
                })
                result.widget_info = {
                    widget_tag: appBindWidget?.widget_tag,
                    app_id: appBindWidget?.app_id,
                    user_subscribed: !!userSubscribed,
                }
            }
        }

        return result
    }

    async getTokenRewards(
        userInfo: UserJwtExtractDto,
        query: UserTokenRewardsQueryDto,
    ): Promise<UserTokenRewardsListDto> {
        const user = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!user) {
            throw new BadRequestException("user not found")
        }

        const where: Prisma.view_user_rewards_summaryWhereInput = {
            user: user.username_in_be,
            rewards: {
                gt: 0,
            },
            ticker: {
                not: "usdc",
            },
        }

        if (query.token) {
            where.token = query.token
        }

        const tokenRewards = await this.prisma.view_user_rewards_summary.findMany({
            where: where,
            take: parseInt(query.page_size),
            skip: Math.max(0, parseInt(query.page) - 1) * Math.max(1, parseInt(query.page_size)),
        })

        const total = await this.prisma.view_user_rewards_summary.findMany({
            where: where,
        })

        return {
            rewards: tokenRewards.map((token) => ({
                token: token.token,
                ticker: token.ticker,
                rewards: token.rewards.toNumber(),
                locked: token.locked.toNumber(),
                released: token.released.toNumber(),
                token_info: token.token_info as any,
                availables: token.released.minus(token.withdrawn).toNumber(),
            })),
            total: total.length,
        }
    }

    //claim rewards
    async claimRewards(userInfo: UserJwtExtractDto, body: ClaimRewardsDto): Promise<ClaimRewardsHistoryListDto> {
        const user = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!user) {
            throw new BadRequestException("user not found")
        }

        const token = await this.prisma.view_user_rewards_summary.findFirst({
            where: {
                user: user.username_in_be,
                token: body.token,
            },
        })
        if (!token) {
            throw new BadRequestException("token not found")
        }

        const available = token.released.minus(token.withdrawn)

        if (available.lt(body.amount)) {
            throw new BadRequestException("not enough available")
        }

        const claim = await this.prisma.user_rewards_withdraw.create({
            data: {
                user: user.username_in_be,
                token: body.token,
                ticker: token.ticker,
                withdrawn: body.amount,
                status: ClaimStatus.PENDING,
            },
        })

        return await this.getClaimRewardsHistory(userInfo, {
            id: claim.id.toString(),
            token: body.token,
            page: "1",
            page_size: "1",
        })
    }

    async getClaimRewardsHistory(
        userInfo: UserJwtExtractDto,
        query: ClaimRewardsQueryDto,
    ): Promise<ClaimRewardsHistoryListDto> {
        const user = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!user) {
            throw new BadRequestException("user not found")
        }

        const where: Prisma.user_rewards_withdrawWhereInput = {
            user: user.username_in_be,
        }

        if (query.token) {
            where.token = query.token
        }

        if (query.id) {
            where.id = parseInt(query.id.toString())
        }

        const claims = await this.prisma.user_rewards_withdraw.findMany({
            where: where,
            take: parseInt(query.page_size),
            skip: Math.max(0, parseInt(query.page) - 1) * Math.max(1, parseInt(query.page_size)),
        })

        const total = await this.prisma.user_rewards_withdraw.count({
            where: where,
        })

        return {
            claims: claims.map((claim) => ({
                id: claim.id,
                token: claim.token,
                ticker: claim.ticker,
                withdrawn: claim.withdrawn.toNumber(),
                status: claim.status as ClaimStatus,
                created_at: claim.created_at,
                updated_at: claim.updated_at,
                user: claim.user,
            })),
            total: total,
        }
    }

    async getRegisterInfo(userInfo: UserJwtExtractDto): Promise<RegisterInfoDTO> {
        const user = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })

        let registerInfo: RegisterInfoDTO = {
            type: "direct",
            source_link: null,
            app_id: null,
            from_widget_tag: null,
            source_link_summary: null,
        }

        if (!user.from_source_link) {
            return registerInfo
        }

        let sourceLinkDetail: LinkDetailDto | null = null
        sourceLinkDetail = await this.linkService.getLink(user.from_source_link)
        if (!sourceLinkDetail) {
            return registerInfo
        }

        if (sourceLinkDetail.redirect_to_widget) {
            registerInfo.type = "widget"
            registerInfo.source_link_summary = {
                creator: sourceLinkDetail.creator,
                short_link: sourceLinkDetail.short_link,
                link_pic: sourceLinkDetail.link_pic,
            }
            registerInfo.source_link = user.from_source_link
            registerInfo.from_widget_tag = sourceLinkDetail.redirect_to_widget
        }

        return registerInfo
    }

    //get user wallet detail
    async getUserWalletDetail(
        userInfo: UserJwtExtractDto,
        page: number = 1,
        pageSize: number = 10,
        mint?: string,
    ): Promise<UserWalletDetailDto> {
        const userProfile = await this.getProfile(userInfo)
        if (!userProfile.email) {
            throw new BadRequestException("user email not found")
        }
        const walletDetail = await this.giggleService.getUserWalletDetail(userInfo, page, pageSize, mint)

        const income = 0
        const totalBalanceChange24h = await this.giggleService.getTotalBalanceChange24h(
            userProfile.usernameShorted,
            walletDetail.total_balance,
        )

        return {
            ...walletDetail,
            ip_license_incomes: income,
            total_balance_change_24h: totalBalanceChange24h || 0,
        }
    }

    //get user wallet detail
    async getUserWalletDetailonChain(userInfo: UserJwtExtractDto, mint?: string) {
        const userProfile = await this.getProfile(userInfo)
        if (!userProfile.email) {
            throw new BadRequestException("user email not found")
        }
        return await this.giggleService.getWalletBalance(userInfo.wallet_address, mint)
    }

    //follow
    async follow(userInfo: UserJwtExtractDto, user: string) {
        if (userInfo.usernameShorted === user) {
            throw new BadRequestException("cannot follow yourself")
        }
        const targetUser = await this.prisma.users.findUnique({
            where: {
                username_in_be: user,
            },
        })
        if (!targetUser) {
            throw new BadRequestException("target user not exists")
        }

        const userRecord = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!userRecord) {
            throw new BadRequestException("user not exists")
        }

        const record = await this.prisma.user_followers.findFirst({
            where: {
                user: targetUser.username_in_be,
                follower: userInfo.usernameShorted,
            },
        })
        if (record) {
            throw new BadRequestException("already followed")
        }

        return await this.prisma.$transaction(async (tx) => {
            await tx.user_followers.create({
                data: {
                    user: targetUser.username_in_be,
                    follower: userInfo.usernameShorted,
                },
            })
            const currentFollowers = targetUser.followers
            await tx.users.update({
                where: {
                    username_in_be: targetUser.username_in_be,
                },
                data: { followers: currentFollowers + 1 },
            })

            const currentFollowing = userRecord.following
            await tx.users.update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                data: { following: currentFollowing + 1 },
            })
            return {
                success: true,
            }
        })
    }

    //unfollow
    async unfollow(userInfo: UserJwtExtractDto, user: string) {
        const targetUser = await this.prisma.users.findUnique({
            where: {
                username_in_be: user,
            },
        })
        if (!targetUser) {
            throw new BadRequestException("target user not exists")
        }

        const userRecord = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!userRecord) {
            throw new BadRequestException("user not exists")
        }

        const record = await this.prisma.user_followers.findFirst({
            where: {
                user: targetUser.username_in_be,
                follower: userInfo.usernameShorted,
            },
        })
        if (!record) {
            return {
                success: true,
            }
        }

        return await this.prisma.$transaction(async (tx) => {
            await tx.user_followers.deleteMany({
                where: {
                    user: targetUser.username_in_be,
                    follower: userInfo.usernameShorted,
                },
            })
            const currentFollowers = targetUser.followers
            await tx.users.update({
                where: {
                    username_in_be: targetUser.username_in_be,
                },
                data: { followers: Math.max(0, currentFollowers - 1) },
            })
            const currentFollowing = userRecord.following
            await tx.users.update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                data: { following: Math.max(0, currentFollowing - 1) },
            })
            return {
                success: true,
            }
        })
    }

    async generateDefaultAvatar(usernameShorted: string): Promise<string> {
        const user = await this.prisma.users.findUnique({
            where: {
                username_in_be: usernameShorted,
            },
        })
        if (!user) {
            throw new BadRequestException("user not exists")
        }
        if (!user.avatar) {
            try {
                const { createAvatar } = await import("@dicebear/core")
                const { initials } = await import("@dicebear/collection")
                const avatar = createAvatar(initials, {
                    seed: user.username,
                    radius: 50,
                    backgroundType: ["gradientLinear"],
                    fontSize: 36,
                }).toString()

                // Write SVG to temporary file using promises
                const tempFilePath = `/tmp/${usernameShorted}.svg`
                await new Promise<void>((resolve, reject) => {
                    fs.writeFile(tempFilePath, avatar, (err) => {
                        if (err) reject(err)
                        else resolve()
                    })
                })

                // Read the file
                const fileBuffer = await new Promise<Buffer>((resolve, reject) => {
                    fs.readFile(tempFilePath, (err, data) => {
                        if (err) reject(err)
                        else resolve(data)
                    })
                })

                // Create a mock file object for S3 upload
                const mockFile: Express.Multer.File = {
                    buffer: fileBuffer,
                    originalname: `${usernameShorted}.svg`,
                    mimetype: "image/svg+xml",
                    fieldname: "avatar",
                    encoding: "7bit",
                    size: fileBuffer.length,
                    stream: null,
                    destination: "",
                    filename: "",
                    path: "",
                }

                // Upload to S3
                const avatarUrl = await this.utilitiesService.uploadToPublicS3(mockFile, usernameShorted)

                // Update user record with avatar URL
                await this.prisma.users.update({
                    where: {
                        username_in_be: usernameShorted,
                    },
                    data: { avatar: avatarUrl },
                })

                // Clean up temp file
                fs.unlink(tempFilePath, (err) => {
                    if (err) this.logger.error(`Error deleting temp file: ${err.message}`)
                })

                return avatarUrl
            } catch (error) {
                this.logger.error(`Failed to generate avatar: ${error.message}`)
                throw new BadRequestException(`Failed to generate avatar: ${error.message}`)
            }
        }

        return user.avatar
    }

    //reset password
    async resetPassword(email: ResetPasswordDto): Promise<any> {
        const userEmail: string = email.email
        const user = await this.getUserInfoByEmail(userEmail)
        if (!user) {
            throw new BadRequestException("user not exists")
        }
        const resetRecord = await this.prisma.user_reset_password_record.findFirst({
            where: {
                email: userEmail,
            },
        })
        let nowMinus1Minutes = new Date()
        nowMinus1Minutes.setMinutes(nowMinus1Minutes.getMinutes() - 1)
        if (resetRecord && resetRecord.created_at > nowMinus1Minutes) {
            throw new BadRequestException("reset password email already sent in one minute")
        }
        try {
            const token = crypto.randomBytes(16).toString("hex")
            await this.prisma.user_reset_password_record.upsert({
                where: {
                    email: userEmail,
                },
                update: {
                    token: token,
                    created_at: new Date(),
                },
                create: {
                    email: userEmail,
                    token: token,
                    created_at: new Date(),
                },
            })
            await this.notificationService.sendNotification(
                "Reset Your Password for 3bodylabs.ai",
                userEmail,
                "action",
                {
                    summary: `Dear ${userEmail},`,
                    description:
                        "We received a request to reset the password for your 3bodylabs account. If you did not make this request, please ignore this email. However, if you need to reset your password, please click on the link below: (For your protection, this link will expire in 24 hours)",
                    url: `${process.env.FRONTEND_URL}/user/resetPassword/submit?email=${userEmail}&token=${token}`,
                    name: "Reset Password",
                },
            )
            return {}
        } catch (error) {
            throw new BadRequestException(error.message)
        }
    }

    //check reset password token
    async checkResetPasswordToken(tokenInfo: CheckResetPasswordTokenDto): Promise<{}> {
        try {
            let yesterDay = new Date()
            yesterDay.setHours(yesterDay.getHours() - 24)
            const record = await this.prisma.user_reset_password_record.findUnique({
                where: {
                    email: tokenInfo.email,
                    token: tokenInfo.token,
                },
            })
            if (!record) {
                throw new Error("invalid email or token")
            }
            if (record.created_at < yesterDay) {
                throw new Error("token expired")
            }
            return {}
        } catch (error) {
            throw new BadRequestException(error.message)
        }
    }

    //submit reset password
    async submitResetPassword(passwordInfo: SubmitResetPasswordDto): Promise<{}> {
        try {
            if (!UserService.isStrongPassword(passwordInfo.password)) {
                throw new Error(
                    "password must be at least 8 characters long and contain at least 1 lowercase, 1 uppercase and 1 numeric",
                )
            }
            if (passwordInfo.password !== passwordInfo.repeatPassword) {
                throw new Error("password and repeat password not match")
            }
            await this.checkResetPasswordToken(passwordInfo)

            const user = await this.getUserInfoByEmail(passwordInfo.email)
            if (!user) {
                throw new Error("user not exists")
            }

            await this.prisma.$transaction([
                this.prisma.users.update({
                    where: {
                        email: passwordInfo.email,
                    },
                    data: {
                        password: UserService.cryptoString(passwordInfo.password),
                    },
                }),
                this.prisma.user_reset_password_record.delete({
                    where: {
                        email: passwordInfo.email,
                    },
                }),
            ])
            return {}
        } catch (error) {
            throw new BadRequestException(error.message)
        }
    }

    async sendEmailConfirmation(userInfo: UserJwtExtractDto) {
        if (!userInfo.email || !isEmail(userInfo.email)) {
            throw new BadRequestException("email is empty")
        }
        const _userInfo = await this.getUserInfoByEmail(userInfo.email)
        if (!_userInfo) {
            throw new BadRequestException("user not exists")
        }
        if (_userInfo.emailConfirmed) {
            throw new BadRequestException("this email already confirmed")
        }

        const userRecord = await this.prisma.users.findFirst({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        //determine if email already sent in 1 minute
        let nowMinus1Minutes = new Date()
        nowMinus1Minutes.setMinutes(nowMinus1Minutes.getMinutes() - 1)
        if (userRecord.email_confirm_token_created_at && userRecord.email_confirm_token_created_at > nowMinus1Minutes) {
            throw new BadRequestException("email already sent in one minute")
        }

        //create token and send email
        const token = crypto.randomBytes(16).toString("hex")
        this.prisma.users
            .update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                    email: userInfo.email,
                },
                data: {
                    email_confirm_token: token,
                    email_confirm_token_created_at: new Date(),
                },
            })
            .then(() => {
                this.notificationService.sendNotification("Email confirmation", userInfo.email, "action", {
                    summary: "Welcome to 3bodylabs. Please confirm your email address by clicking the link below.",
                    description:
                        "We may need to send you critical information about our service and it is important that we have an accurate email address.",
                    url: `${process.env.FRONTEND_URL}/user/confirmEmail?email=${userInfo.email}&token=${token}`,
                    name: "Confirm Email Address",
                })
            })
        return {}
    }

    async bindEmail(emailInfo: BindEmailReqDto, userInfo: UserJwtExtractDto) {
        if (!emailInfo.email || !isEmail(emailInfo.email)) {
            throw new BadRequestException("email is invalid")
        }
        const record = await this.getUserInfoByEmail(emailInfo.email)
        if (record) {
            throw new BadRequestException("email already exists")
        }

        const _userInfo = await this.getUserInfoByUsernameShorted(userInfo.usernameShorted)
        if (!_userInfo) {
            throw new BadRequestException("user not exists")
        }
        await this.prisma.users.update({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            data: {
                email: emailInfo.email,
                email_confirmed: false,
                email_confirm_token: null,
                email_confirm_token_created_at: null,
            },
        })
        this.sendEmailConfirmation({ ...userInfo, email: emailInfo.email })
        return {}
    }

    async updateAvatar(userInfo: UserJwtExtractDto, avatar: Express.Multer.File) {
        try {
            //resize avatar to 300x300
            const resizedAvatar = await sharp(avatar.buffer)
                .resize(300, 300, {
                    fit: "cover",
                    position: "center",
                })
                .toBuffer()

            const result = await this.utilitiesService.uploadToPublicS3(
                { ...avatar, buffer: resizedAvatar },
                userInfo.usernameShorted,
            )
            await this.prisma.users.update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                data: {
                    avatar: result,
                },
            })
            return this.getProfile(userInfo)
        } catch (error) {
            this.logger.error(
                `Error updating avatar: ${JSON.stringify(error)}, requested params: ${JSON.stringify(userInfo)}, email: ${userInfo.email}`,
            )
            throw new BadRequestException("upload avatar failed")
        }
    }

    async requestContactUs(contactInfo: ContactDTO) {
        await this.prisma.request_contact_us.create({
            data: {
                first_name: contactInfo.first_name,
                last_name: contactInfo.last_name,
                email: contactInfo.email,
                phone_number: contactInfo.phone_number,
                message: contactInfo.message,
            },
        })

        let sendTo = process.env.CONTACT_EMAIL || "Info@3bodylabs.ai"

        //send email
        this.notificationService.sendTextNotification(
            "New Contact Us Request",
            sendTo,
            `
New Contact Us Request:
Name: ${contactInfo.first_name} ${contactInfo.last_name}
Email: ${contactInfo.email}
Phone: ${contactInfo.phone_number}
Message: ${contactInfo.message}
`,
        )
        return {}
    }

    async inviteCode(userInfo: UserJwtExtractDto) {
        const record = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!record) throw new BadRequestException("user not exists")
        if (!record.invite_code || record.invite_code === "") {
            const inviteCode = crypto.randomBytes(16).toString("hex").substring(16)
            await this.prisma.users.update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                data: {
                    invite_code: inviteCode,
                },
            })
            return { code: inviteCode }
        }
        return { code: record.invite_code }
    }

    async updateProfile(updatedInfo: UpdateProfileReqDto, userInfo: UserJwtExtractDto) {
        const user = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (!user) {
            throw new BadRequestException("user not exists")
        }
        const usernameAlreadyExists = await this.prisma.users.findFirst({
            where: {
                username: updatedInfo.username,
                username_in_be: {
                    not: userInfo.usernameShorted,
                },
            },
        })
        if (usernameAlreadyExists) {
            throw new BadRequestException("this username already exists")
        }
        await this.prisma.users.update({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
            data: {
                username: updatedInfo.username,
                description: updatedInfo.description,
            },
        })
        return this.getProfile(userInfo)
    }

    async sendLoginCode(userInfo: LoginCodeReqDto, appId?: string, deviceId?: string) {
        if (!userInfo.email || !isEmail(userInfo.email)) {
            throw new BadRequestException("email is invalid")
        }

        let inviteUser = ""
        if (userInfo.source_link_id) {
            const iUser = await this.prisma.users.findFirst({
                where: {
                    invite_code: userInfo.invite_code,
                },
            })
            inviteUser = iUser?.username_in_be
        }

        let user = await this.getUserInfoByEmail(userInfo.email)
        if (!user) {
            //find invited user

            let fromSourceLink = ""
            let newUserAppId = appId

            if (userInfo.source_link_id) {
                const linkId = userInfo.source_link_id
                const linkDetail = await this.prisma.app_links.findUnique({
                    where: {
                        unique_str: linkId,
                    },
                })
                if (linkDetail) {
                    inviteUser = linkDetail.creator
                    fromSourceLink = linkId
                    newUserAppId = linkDetail.app_id
                }
            }
            //create user
            const userNameShorted = this.generateShortName()
            const username = userInfo.email.split("@")[0]
            const newUserInfo: CreateUserDto = {
                user_id: userNameShorted,
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: userInfo.email,
                usernameShorted: userNameShorted,
                app_id: newUserAppId,
                from_source_link: fromSourceLink,
                from_device_id: deviceId,
                can_create_ip: inviteUser ? true : false,
                invited_by: inviteUser,
            }
            user = await this.createUser(newUserInfo)
        }

        const userRecord = await this.prisma.users.findUnique({
            where: {
                username_in_be: user.usernameShorted,
            },
        })

        if (
            userRecord.login_code_requested_at &&
            userRecord.login_code_requested_at > new Date(Date.now() - 1000 * 60 * 1)
        ) {
            throw new BadRequestException("Please wait 1 minutes before requesting another code")
        }

        const code = Math.floor(100000 + Math.random() * 900000).toString()
        await this.prisma.users.update({
            where: {
                username_in_be: user.usernameShorted,
            },
            data: {
                can_create_ip: inviteUser ? true : userRecord.can_create_ip,
                login_code: code,
                login_code_requested_at: new Date(),
                login_code_expired: new Date(Date.now() + 1000 * 60 * 5), //5 minutes
            },
        })
        const email = user.email
        try {
            await this.notificationService.sendNotification(
                "[Giggle] Login Verification Code",
                email,
                "code_giggle",
                {
                    summary: "Login Verification Code",
                    description: "Hello, Your login code is: ",
                    code: code,
                },
                "mail.giggle.pro",
                "Giggle.Pro <app-noreply@giggle.pro>",
            )
        } catch (error) {
            throw new InternalServerErrorException("Send login code failed")
        }
        return { success: true }
    }

    async getInvitations(code: string): Promise<InvitationsDetailDto> {
        const record = await this.prisma.users.findFirst({
            where: {
                invite_code: code,
            },
        })
        if (!record) {
            throw new BadRequestException("invitation code not exists")
        }
        return {
            inviter_id: record.username_in_be,
            inviter_name: record.username,
            inviter_avatar: record.avatar,
            message: "Welcome to Giggle!",
        }
    }

    async getInviteCode(userInfo: UserJwtExtractDto) {
        const record = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
                is_blocked: false,
            },
        })
        if (!record) {
            throw new BadRequestException("user not exists")
        }

        let code = record.invite_code
        if (!code) {
            code = crypto.randomBytes(16).toString("hex").substring(0, 8)
            await this.prisma.users.update({
                where: {
                    username_in_be: userInfo.usernameShorted,
                },
                data: {
                    invite_code: code,
                },
            })
        }
        return { code: code }
    }

    generateShortName(): string {
        return crypto.randomBytes(9).toString("hex")
    }

    mapUserInfo(record: any): UserInfoDTO {
        return {
            user_id: record.username_in_be,
            address: record.address,
            username: record.username,
            usernameShorted: record.username_in_be,
            email: record.email,
            emailConfirmed: record.email_confirmed,
            avatar: record.avatar,
            description: record.description,
            followers: record.followers,
            following: record.following,
            can_create_ip: record?.can_create_ip || false,
            is_developer: record?.is_developer || false,
            phone_number: record?.phone_number || "",
            phone_national: record?.phone_national || "",
            current_credit_balance: record?.current_credit_balance || 0,
            wallet_address: record?.wallet_address || "",
        }
    }

    static cryptoString(str: string): string {
        return crypto.createHash("md5").update(str).digest("hex")
    }

    static cryptoStringWithSalt(user: UserJwtExtractDto, str: string): string {
        const userSalt = user.usernameShorted
        return crypto
            .createHash("md5")
            .update(userSalt + str)
            .digest("hex")
    }

    static convertDuration(time: number) {
        if (time < 60) {
            return time + "s"
        } else if (time >= 60 && time < 60 * 60) {
            const min = Math.floor(time / 60)
            const second = time - min * 60
            return min + "min" + (second > 0 ? second + "s" : "")
        } else if (time >= 60 * 60 && time < 60 * 60 * 24) {
            let _t = time
            const hours = Math.floor(_t / (60 * 60))
            _t -= hours * (60 * 60)
            const min = Math.floor(_t / 60)
            _t -= min * 60
            const second = _t
            return hours + "h" + (min > 0 ? min + "m" : "") + (second > 0 ? second + "s" : "")
        } else if (time >= 60 * 60 * 24) {
            let _t = time
            const days = Math.floor(_t / (60 * 60 * 24))
            _t -= days * (60 * 60 * 24)
            const hours = Math.floor(_t / (60 * 60))
            _t -= hours * (60 * 60)
            const min = Math.floor(_t / 60)
            _t -= min * 60
            const second = _t
            return (
                days +
                "d" +
                (hours > 0 ? hours + "h" : "") +
                (min > 0 ? min + "m" : "") +
                (second > 0 ? second + "s" : "")
            )
        }
    }

    static isStrongPassword(password: string): boolean {
        return validator.isStrongPassword(password, {
            minLength: 8,
            minLowercase: 1,
            minUppercase: 1,
            minNumbers: 1,
            minSymbols: 0,
        })
    }

    //@Cron(CronExpression.EVERY_10_MINUTES)
    //async generateDefaultAvatarCron() {
    //    const users = await this.prisma.users.findMany()
    //    for (const user of users) {
    //        if (!user.avatar) {
    //            const avatar = await this.generateDefaultAvatar(user.username_in_be)
    //            this.logger.log(`generate default avatar for ${user.username_in_be}`)
    //        }
    //    }
    //}
}
