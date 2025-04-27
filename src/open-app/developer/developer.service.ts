import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { DeveloperWidgetCreateDto, DeveloperWidgetUpdateDto } from "./developer.dto"
import { CreateUserDto, UserJwtExtractDto } from "src/user/user.controller"
import { WidgetSettingsDto } from "../widgets/widget.dto"
import { WidgetsService } from "../widgets/widgets.service"
import { widgets } from "@prisma/client"
import { Prisma } from "@prisma/client"
import { UserService } from "src/user/user.service"
import * as crypto from "crypto"
import { isEmail } from "class-validator"
@Injectable()
export class DeveloperService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly widgetsService: WidgetsService,
        private readonly usersService: UserService,
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

        const newWidget: string = await this.prisma.$transaction(async (tx) => {
            const widget = await tx.widgets.create({
                data: {
                    tag: tag,
                    name: mappedWidget.name,
                    summary: mappedWidget.summary,
                    pricing: mappedWidget.pricing,
                    is_featured: mappedWidget.is_featured,
                    is_new: mappedWidget.is_new,
                    is_official: mappedWidget.is_official,
                    category: mappedWidget.category,
                    description: mappedWidget.description,
                    coming_soon: mappedWidget.coming_soon,
                    priority: mappedWidget.priority,
                    author: user.usernameShorted,
                    icon: mappedWidget.icon,
                    settings: mappedWidget.settings,
                    test_users: mappedWidget.test_users,
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
                data: updatedWidget,
            })

            //resubscribe to widget for test users and author
            //remove first
            await tx.user_subscribed_widgets.deleteMany({
                where: { widget_tag: body.tag },
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
                        widget_tag: body.tag,
                    })),
            })

            //sub for author
            await tx.user_subscribed_widgets.create({
                data: {
                    subscription_id: this.widgetsService.generateId(),
                    user: user.usernameShorted,
                    widget_tag: body.tag,
                },
            })

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
}
