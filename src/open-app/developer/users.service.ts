import { Injectable, NotFoundException } from "@nestjs/common"
import { PrismaService } from "src/common/prisma.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import { UserService } from "src/user/user.service"

@Injectable()
export class UsersService {
    constructor(
        private readonly prisma: PrismaService,
        private readonly userService: UserService,
    ) {}

    async getUserInfo(reqUser: UserJwtExtractDto, email: string) {
        const user = await this.prisma.users.findUnique({
            where: { email: email },
        })
        if (!user) {
            throw new NotFoundException("User not found")
        }
        return this.userService.getProfile({ user_id: user.username_in_be, usernameShorted: user.username_in_be })
    }
}
