// google.strategy.ts

import { Injectable } from "@nestjs/common"
import { PassportStrategy } from "@nestjs/passport"
import { Strategy, VerifyCallback } from "passport-google-oauth20"
import { UserInfoDTO } from "src/user/user.controller"
import { UserService } from "src/user/user.service"
import * as crypto from "crypto"
import { HttpsProxyAgent } from "https-proxy-agent"
require("https").globalAgent.options.rejectUnauthorized = false
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, "google") {
    constructor(private userService: UserService) {
        super({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL,
            scope: ["email"],
            proxy: process.env.ENV === "local" ? new HttpsProxyAgent("http://127.0.0.1:7890") : null,
        })
    }

    async validate(_accessToken: string, _refreshToken: string, profile: any, done: VerifyCallback): Promise<any> {
        const { emails } = profile
        const email = emails[0].value
        let userInfo = await this.userService.getUserInfoByEmail(email)
        if (!userInfo) {
            const userNameShorted = this.userService.generateShortName()
            const username = email.split("@")[0]
            const newUserInfo: UserInfoDTO = {
                username: username,
                password: crypto.randomBytes(9).toString("hex"), //a random string as password, user need reset this password later
                email: email,
                usernameShorted: userNameShorted,
                emailConfirmed: true,
            }
            userInfo = await this.userService.createUser(newUserInfo)
        }
        done(null, userInfo)
    }
}
