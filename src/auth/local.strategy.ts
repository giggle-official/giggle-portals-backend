import { Injectable, BadRequestException } from "@nestjs/common"
import { AuthService } from "./auth.service"
import { UserService } from "src/user/user.service"
import { Strategy } from "passport-local"
import { PassportStrategy } from "@nestjs/passport"
import { isEmail } from "class-validator"

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy, "local") {
    constructor(
        private authService: AuthService,
        private userService: UserService,
    ) {
        super({ usernameField: "email" })
    }

    async validate(email: string, password: string): Promise<any> {
        if (!isEmail(email)) {
            throw new BadRequestException("email is invalid")
        }
        let user = await this.userService.getUserInfoByEmail(email)
        if (!user) {
            throw new BadRequestException("user authorization fail, please try again")
        }
        user = await this.authService.verifyUserInfo(user, password)
        if (!user) {
            throw new BadRequestException("user authorization fail, please try again")
        }
        return user
    }
}
