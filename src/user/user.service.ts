import { BadRequestException, forwardRef, Inject, Injectable, InternalServerErrorException } from "@nestjs/common"
import {
    UserInfoDTO,
    EmailUserCreateDto,
    ResetPasswordDto,
    CheckResetPasswordTokenDto,
    SubmitResetPasswordDto,
    BindEmailReqDto,
    UpdateProfileReqDto,
    RegisterInfoDTO,
} from "./user.controller"
import { PrismaService } from "src/common/prisma.service"
import * as crypto from "crypto"
import { isEmail } from "class-validator"
import validator from "validator"
import { NotificationService } from "src/notification/notification.service"
import { ContactDTO, LoginCodeReqDto } from "./user.dto"
import { CreditService } from "src/credit/credit.service"
import { UtilitiesService } from "src/common/utilities.service"
import { GiggleService } from "src/web3/giggle/giggle.service"
import { UserWalletDetailDto } from "./user.dto"
import { PriceService } from "src/web3/price/price.service"
import { Prisma } from "@prisma/client"
import { PinataSDK } from "pinata-web3"
import { Readable } from "stream"
import { LinkService } from "src/open-app/link/link.service"
import { LinkDetailDto } from "src/open-app/link/link.dto"
@Injectable()
export class UserService {
    constructor(
        private prisma: PrismaService,
        private readonly notificationService: NotificationService,

        @Inject(forwardRef(() => CreditService))
        private readonly creditService: CreditService,

        @Inject(forwardRef(() => GiggleService))
        private readonly giggleService: GiggleService,

        @Inject(forwardRef(() => LinkService))
        private readonly linkService: LinkService,
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

        return this.processUserInfo(record)
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

        return this.processUserInfo(record)
    }

    async createUser(userInfo: UserInfoDTO): Promise<UserInfoDTO> {
        const record = await this.prisma.users.findFirst({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        if (record) {
            throw new BadRequestException("user already exists, please sign in directly")
        }

        const data: Prisma.usersCreateInput = {
            username: userInfo.username || userInfo.usernameShorted,
            password: UserService.cryptoString(userInfo.password),
            email: userInfo.email,
            username_in_be: userInfo.usernameShorted,
            email_confirmed: userInfo.emailConfirmed,
            current_plan: "Free",
            agent_user: UtilitiesService.generateRandomApiKey(),
        }

        await this.prisma.users.create({
            data: data,
        })

        //bind giggle wallet
        await this.giggleService.bindGiggleWallet(userInfo.email)

        //issue free credit
        await this.creditService.issueFreeCredits(userInfo.usernameShorted)
        return userInfo
    }

    async getProfile(userInfo: UserInfoDTO): Promise<UserInfoDTO> {
        const _userInfoFromDb = await this.getUserInfoByUsernameShorted(userInfo.usernameShorted)

        return {
            username: _userInfoFromDb.username,
            usernameShorted: _userInfoFromDb.usernameShorted,
            email: _userInfoFromDb.email,
            emailConfirmed: _userInfoFromDb.emailConfirmed,
            avatar: _userInfoFromDb.avatar,
            giggle_wallet_address: await GiggleService.getGiggleWalletAddress(_userInfoFromDb.usernameShorted),
            description: _userInfoFromDb.description,
            followers: _userInfoFromDb.followers,
            following: _userInfoFromDb.following,
            can_create_ip: _userInfoFromDb.can_create_ip,
            permissions: userInfo?.permissions,
            widget_info: userInfo?.widget_info,
            source_link: userInfo?.source_link, //this field is user from under current login
            is_developer: _userInfoFromDb?.is_developer,
            register_info: await this.getRegisterInfo(userInfo),
        }
    }

    async getRegisterInfo(userInfo: UserInfoDTO): Promise<RegisterInfoDTO> {
        const user = await this.prisma.users.findUnique({
            where: {
                username_in_be: userInfo.usernameShorted,
            },
        })
        let sourceLinkDetail: LinkDetailDto | null = null
        if (user.from_source_link) {
            sourceLinkDetail = await this.linkService.getLink(user.from_source_link)
        }

        let registerInfo: RegisterInfoDTO = {
            type: "direct",
            source_link: null,
            app_id: null,
            from_widget_tag: null,
            source_link_summary: null,
        }

        if (sourceLinkDetail) {
            //if user register from source link
            if (sourceLinkDetail.redirect_to_widget) {
                registerInfo.type = "widget"
                registerInfo.source_link_summary = {
                    creator: sourceLinkDetail.creator,
                    link_url: sourceLinkDetail.link_url,
                }
                registerInfo.source_link = user.from_source_link
                registerInfo.from_widget_tag = sourceLinkDetail.redirect_to_widget
            } else {
                registerInfo.type = "link"
                registerInfo.source_link_summary = {
                    creator: sourceLinkDetail.creator,
                    link_url: sourceLinkDetail.link_url,
                }
                registerInfo.source_link = user.from_source_link
            }
            return registerInfo
        }

        if (user.register_app_id) {
            registerInfo.type = "app"
            registerInfo.app_id = user.register_app_id
        }

        return registerInfo
    }

    //create email user
    async newEmailUser(user: EmailUserCreateDto) {
        if (!isEmail(user.email)) {
            throw new BadRequestException("invalid email")
        }
        if (!UserService.isStrongPassword(user.password)) {
            throw new BadRequestException(
                "password must be at least 8 characters long and contain at least 1 lowercase, 1 uppercase and 1 numeric",
            )
        }

        const record = await this.getUserInfoByEmail(user.email)
        if (record) {
            throw new BadRequestException("user exists, login directly or reset your password")
        }

        const usernameShorted = this.generateShortName()
        const username = user.email.split("@")[0]
        const userInfo: UserInfoDTO = {
            username: username,
            password: user.password,
            email: user.email,
            usernameShorted: usernameShorted,
            emailConfirmed: false,
        }
        await this.createUser(userInfo)

        // process invite
        if (user.invite_code && user.invite_code !== "") {
            const inviteUser = await this.prisma.users.findFirst({
                where: {
                    invite_code: user.invite_code,
                },
            })
            if (inviteUser) {
                await this.prisma.users.update({
                    data: {
                        invited_by: inviteUser.username_in_be,
                    },
                    where: {
                        username_in_be: userInfo.usernameShorted,
                    },
                })
                //await this.processRewards(inviteUser, userInfo)
            }
        }

        //send confirmation email
        this.sendEmailConfirmation(userInfo)
        return {}
    }

    //get user wallet detail
    async getUserWalletDetail(
        userInfo: UserInfoDTO,
        page: number = 1,
        pageSize: number = 10,
        mint?: string,
    ): Promise<UserWalletDetailDto> {
        const userProfile = await this.getProfile(userInfo)
        if (!userProfile.email) {
            throw new BadRequestException("user email not found")
        }
        const walletDetail = await this.giggleService.getUserWalletDetail(userInfo, page, pageSize, mint)
        const ipLicenseIncomes = await this.prisma.ip_license_income.aggregate({
            where: {
                allocated_to: userProfile.usernameShorted,
            },
            _sum: {
                income: true,
            },
        })
        const income = ipLicenseIncomes._sum.income * PriceService.CREDIT2USD_PRICE || 0
        const totalBalanceChange24h = await this.giggleService.getTotalBalanceChange24h(
            userProfile.usernameShorted,
            walletDetail.total_balance,
        )

        return {
            ...walletDetail,
            ip_license_incomes: income || 0,
            total_balance_change_24h: totalBalanceChange24h || 0,
        }
    }

    //follow
    async follow(userInfo: UserInfoDTO, user: string) {
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
    async unfollow(userInfo: UserInfoDTO, user: string) {
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

    async sendEmailConfirmation(userInfo: UserInfoDTO) {
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

    async bindEmail(emailInfo: BindEmailReqDto, userInfo: UserInfoDTO) {
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

    async updateAvatar(userInfo: UserInfoDTO, avatar: Express.Multer.File) {
        try {
            const result = await this._processAvatar(avatar)
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
            console.error(error)
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

    async inviteCode(userInfo: UserInfoDTO) {
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

    async updateProfile(updatedInfo: UpdateProfileReqDto, userInfo: UserInfoDTO) {
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

    private async _processAvatar(file: Express.Multer.File): Promise<string> {
        const pinata = new PinataSDK({
            pinataJwt: process.env.PINATA_JWT,
            pinataGateway: process.env.PINATA_GATEWAY,
        })

        // Create a readable stream from the buffer
        const readable = new Readable()
        readable.push(file.buffer)
        readable.push(null)

        const result = await pinata.upload.stream(readable)

        return process.env.PINATA_GATEWAY + "/ipfs/" + result.IpfsHash
    }

    async sendLoginCode(userInfo: LoginCodeReqDto, appId?: string, sourceLink?: string) {
        if (!userInfo.email || !isEmail(userInfo.email)) {
            throw new BadRequestException("email is invalid")
        }
        let user = await this.getUserInfoByEmail(userInfo.email)
        if (!user) {
            //create user
            const userNameShorted = this.generateShortName()
            const username = userInfo.email.split("@")[0]
            const newUserInfo: UserInfoDTO = {
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: userInfo.email,
                usernameShorted: userNameShorted,
                emailConfirmed: true,
            }
            user = await this.createUser(newUserInfo)
            if (appId) {
                await this.prisma.users.update({
                    where: {
                        username_in_be: user.usernameShorted,
                    },
                    data: {
                        register_app_id: appId,
                    },
                })
            }

            if (sourceLink) {
                //update register source link
                await this.prisma.users.update({
                    where: {
                        username_in_be: user.usernameShorted,
                    },
                    data: {
                        from_source_link: sourceLink,
                    },
                })
            }
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

    generateShortName(): string {
        return crypto.randomBytes(9).toString("hex")
    }

    processUserInfo(record: any): UserInfoDTO {
        return {
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
        }
    }

    static cryptoString(str: string): string {
        return crypto.createHash("md5").update(str).digest("hex")
    }

    static cryptoStringWithSalt(user: UserInfoDTO, str: string): string {
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
}
