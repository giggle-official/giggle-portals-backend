import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { DeveloperWidgetCreateDto, DeveloperWidgetUpdateDto, RequestWidgetAccessTokenDto } from "./developer.dto"
import { CreateUserDto, UserJwtExtractDto } from "src/user/user.controller"
import { WidgetSettingsDto } from "../widgets/widget.dto"
import { WidgetsService } from "../widgets/widgets.service"
import { widgets } from "@prisma/client"
import { Prisma } from "@prisma/client"
import { UserService } from "src/user/user.service"
import * as crypto from "crypto"
import { isEmail } from "class-validator"
import { JwtService } from "@nestjs/jwt"
@Injectable()
export class DeveloperService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly widgetsService: WidgetsService,
        private readonly usersService: UserService,
        private readonly jwtService: JwtService,
    ) {}

    async createWidget(body: DeveloperWidgetCreateDto, user: UserJwtExtractDto) {
        const tag = body.name.toLowerCase().replace(/ /g, "_")
        const widgetExists = await this.prisma.widgets.findFirst({
            where: {
                OR: [{ name: body.name }, { tag: tag }],
            },
        })

        if (widgetExists) {
            throw new BadRequestException("Widget already exists or tag is already taken")
        }

        //process test users
        await this.processTestUsers(body.test_users)

        const mappedWidget = this._mapToCreateWidgetDto(body, user, tag)
        const identify = this.widgetsService.generateIdentity()

        const newWidget: string = await this.prisma.$transaction(async (tx) => {
            const widget = await tx.widgets.create({
                data: {
                    tag: tag,
                    name: mappedWidget.name,
                    summary: mappedWidget.summary,
                    pricing: mappedWidget.pricing,
                    is_featured: mappedWidget.is_featured,
                    is_new: mappedWidget.is_new,
                    is_official: true, //TODO: remove this after testing
                    category: mappedWidget.category,
                    description: mappedWidget.description,
                    coming_soon: mappedWidget.coming_soon,
                    priority: mappedWidget.priority,
                    author: user.usernameShorted,
                    icon: mappedWidget.icon,
                    settings: mappedWidget.settings,
                    test_users: mappedWidget.test_users,
                    demo_url: mappedWidget.demo_url,
                    secret_key: identify.secret_key,
                    access_key: identify.access_key,
                },
            })

            //sub for test users
            //sub for author
            await tx.user_subscribed_widgets.create({
                data: {
                    subscription_id: this.widgetsService.generateId(),
                    user: user.usernameShorted,
                    widget_tag: tag,
                },
            })

            //sub for test users
            const users = await tx.users.findMany({
                where: {
                    email: { in: body.test_users },
                },
            })

            await tx.user_subscribed_widgets.createMany({
                data: users
                    .filter((u) => u.username_in_be !== user.usernameShorted)
                    .map((u) => ({
                        subscription_id: this.widgetsService.generateId(),
                        user: u.username_in_be,
                        widget_tag: tag,
                    })),
            })
            return tag
        })
        return this.getWidgetDetail(newWidget, user)
    }

    _mapToCreateWidgetDto(
        body: DeveloperWidgetCreateDto,
        user: UserJwtExtractDto,
        tag: string,
    ): Prisma.widgetsCreateInput {
        const settings: WidgetSettingsDto = {
            permissions: ["all"], //TODO: change to widget
            management_url: body.management_url,
            widget_url: body.widget_url,
            widget_tag: tag,
            repository_url: body.repository_url,
            metadata: {}, //TODO: add metadata
            type: "iframe", //TODO: change to widget
        }
        return {
            name: body.name,
            summary: body.summary,
            category: body.category,
            icon: body.category,
            description: body.description,
            settings: settings as any,
            demo_url: body.demo_url,
            is_featured: false,
            is_new: false,
            is_official: false,
            coming_soon: false,
            priority: 0,
            is_private: body.is_private,
            is_developing: true,
            pricing: { model: "free" },
            test_users: body.test_users,
        }
    }

    _mapToUpdateWidgetDto(body: DeveloperWidgetUpdateDto, originalWidget: widgets): Prisma.widgetsUpdateInput {
        const originalSettings = originalWidget.settings as unknown as WidgetSettingsDto
        const updatedSettings: WidgetSettingsDto = {
            permissions: ["all"], //TODO: change to widget
            management_url: body.management_url !== undefined ? body.management_url : originalSettings.management_url,
            widget_url: body.widget_url !== undefined ? body.widget_url : originalSettings.widget_url,
            widget_tag: originalSettings.widget_tag,
            repository_url:
                body.repository_url !== undefined ? body.repository_url : originalSettings.metadata.repository_url,
            type: "iframe", //TODO: change to widget
            metadata: originalSettings.metadata,
        }
        return {
            name: body.name !== undefined ? body.name : originalWidget.name,
            summary: body.summary !== undefined ? body.summary : originalWidget.summary,
            pricing: originalWidget.pricing,
            category: body.category !== undefined ? body.category : originalWidget.category,
            icon: body.category !== undefined ? body.category : originalWidget.icon,
            description: body.description !== undefined ? body.description : originalWidget.description,
            settings: updatedSettings as any,
            coming_soon: originalWidget.coming_soon,
            priority: originalWidget.priority,
            test_users: body.test_users !== undefined ? body.test_users : originalWidget.test_users,
            demo_url: body.demo_url !== undefined ? body.demo_url : originalWidget.demo_url,
            is_private: body.is_private !== undefined ? body.is_private : originalWidget.is_private,
        }
    }

    async processTestUsers(testUsers: string[]): Promise<void> {
        //create user if test users are not in the database
        for (const email of testUsers) {
            if (!isEmail(email)) {
                continue
            }
            let userInfo: UserJwtExtractDto
            const userExists = await this.prisma.users.findFirst({
                where: {
                    email: email,
                },
            })
            if (!userExists) {
                const userNameShorted = this.usersService.generateShortName()
                const username = email.split("@")[0]
                const newUserInfo: CreateUserDto = {
                    username: username,
                    password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                    email: email,
                    usernameShorted: userNameShorted,
                    app_id: "",
                    from_source_link: "",
                    from_device_id: "",
                }
                userInfo = await this.usersService.createUser(newUserInfo)
            }
        }
    }

    private async _subscribeToWidget(tag: string, user: UserJwtExtractDto, testUsers: string[]): Promise<void> {
        return
    }

    async getWidgets(user: UserJwtExtractDto) {
        const widgets = await this.prisma.widgets.findMany({
            where: { author: user.usernameShorted },
            include: {
                _count: {
                    select: {
                        user_subscribed_widgets: true,
                    },
                },
                author_info: {
                    select: {
                        username: true,
                        avatar: true,
                    },
                },
            },
        })
        const subscribedWidgets = await this.prisma.user_subscribed_widgets.findMany({
            where: { user: user.usernameShorted },
        })
        return this.widgetsService._mapToSummaryResponse(widgets, subscribedWidgets)
    }

    async getWidgetIdentity(user: UserJwtExtractDto, tag: string) {
        if (!tag) {
            throw new BadRequestException("Tag is required")
        }
        const widget = await this.prisma.widgets.findUnique({
            where: { tag: tag, author: user.usernameShorted },
        })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        let access_key = widget.access_key
        let secret_key = widget.secret_key
        const newIdentity = this.widgetsService.generateIdentity()
        if (!access_key) {
            //generate a random 32 length string
            access_key = newIdentity.access_key
            await this.prisma.widgets.update({
                where: { tag: tag, author: user.usernameShorted },
                data: { access_key: access_key },
            })
        }

        if (!widget.secret_key) {
            //generate a random 64 length string
            secret_key = newIdentity.secret_key
            await this.prisma.widgets.update({
                where: { tag: tag, author: user.usernameShorted },
                data: { secret_key: secret_key },
            })
        }
        return {
            access_key: access_key,
            secret_key: secret_key,
        }
    }

    async getWidgetDetail(tag: string, user: UserJwtExtractDto) {
        const widget = await this.prisma.widgets.findUnique({
            where: { tag: tag, author: user.usernameShorted },
            include: {
                _count: {
                    select: {
                        user_subscribed_widgets: true,
                    },
                },
                author_info: {
                    select: {
                        username: true,
                        avatar: true,
                    },
                },
            },
        })

        if (!widget) {
            throw new NotFoundException("Widget not found")
        }

        const subscribedWidgets = await this.prisma.user_subscribed_widgets.findFirst({
            where: {
                user: user.usernameShorted,
                widget_tag: tag,
            },
        })
        return this.widgetsService.mapToDetailResponse(widget, subscribedWidgets)
    }

    async updateWidget(body: DeveloperWidgetUpdateDto, user: UserJwtExtractDto) {
        const widgetExists = await this.prisma.widgets.findUnique({
            where: { tag: body.tag, author: user.usernameShorted, is_developing: true },
        })
        if (!widgetExists) {
            throw new NotFoundException("Widget not found or not developing")
        }
        const updatedWidget = this._mapToUpdateWidgetDto(body, widgetExists)

        //process test users
        await this.processTestUsers(body.test_users)

        const updatedWidgetTag: string = await this.prisma.$transaction(async (tx) => {
            const widget = await tx.widgets.update({
                where: { tag: body.tag, author: user.usernameShorted },
                data: {
                    ...updatedWidget,
                    is_official: true, //TODO: remove this after testing
                },
            })

            //resubscribe to widget for test users and author
            //sub for test users
            //find exists subscriptions
            let needProcessUsers = await tx.users.findMany({
                where: {
                    email: { in: body.test_users },

                    username_in_be: { not: user.usernameShorted },
                },
                select: {
                    username_in_be: true,
                },
            })

            needProcessUsers = [...needProcessUsers, { username_in_be: user.usernameShorted }]

            //find need delete subscriptions
            const needDeleteSubscriptions = await tx.user_subscribed_widgets.findMany({
                where: {
                    user: { notIn: needProcessUsers.map((u) => u.username_in_be) },
                    widget_tag: body.tag,
                },
            })

            //delete app_bind_widgets
            await tx.app_bind_widgets.deleteMany({
                where: {
                    subscription_id: { in: needDeleteSubscriptions.map((d) => d.id) },
                },
            })

            //delete exists subscriptions
            await tx.user_subscribed_widgets.deleteMany({
                where: {
                    id: { in: needDeleteSubscriptions.map((d) => d.id) },
                },
            })

            for (const user of needProcessUsers) {
                //if subscrption exists, continue
                const isExists = await tx.user_subscribed_widgets.findFirst({
                    where: {
                        user: user.username_in_be,
                        widget_tag: body.tag,
                    },
                })
                if (isExists) {
                    continue
                }
                //else create
                await tx.user_subscribed_widgets.create({
                    data: {
                        subscription_id: this.widgetsService.generateId(),
                        user: user.username_in_be,
                        widget_tag: body.tag,
                    },
                })
            }

            //finally, if exists subscribed. remove
            return widget.tag
        })
        return this.getWidgetDetail(updatedWidgetTag, user)
    }

    // danger operation
    async deleteWidget(tag: string, user: UserJwtExtractDto) {
        try {
            const widget = await this.prisma.widgets.findUnique({
                where: { tag: tag, author: user.usernameShorted, is_developing: true },
            })
            if (!widget) {
                throw new NotFoundException("Widget not found or not developing")
            }
            await this.prisma.$transaction(async (tx) => {
                //remove app binds
                await tx.app_bind_widgets.deleteMany({
                    where: { widget_tag: tag },
                })
                //remove subscribed users
                await tx.user_subscribed_widgets.deleteMany({
                    where: { widget_tag: tag },
                })
                //remove widget
                await tx.widgets.delete({
                    where: { tag: tag, author: user.usernameShorted },
                })
            })
            return {
                status: "success",
            }
        } catch (error) {
            throw new BadRequestException("Failed to delete widget")
        }
    }

    async getWidgetAccessToken(body: RequestWidgetAccessTokenDto) {
        const widget = await this.prisma.widgets.findFirst({
            where: { access_key: body.access_key, secret_key: body.secret_key },
        })
        if (!widget) {
            throw new NotFoundException("Widget not found")
        }
        return this.jwtService.sign(
            {
                iss: widget.access_key,
                widget_tag: widget.tag,
            },
            {
                secret: widget.secret_key,
                expiresIn: "10m",
            },
        )
    }
}
