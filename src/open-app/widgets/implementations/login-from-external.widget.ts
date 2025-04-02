import { Injectable } from "@nestjs/common"
import { Config, Widget } from "../widget.interface"
import * as crypto from "crypto"
import { UserInfoDTO } from "src/user/user.controller"
import { PrismaService } from "src/common/prisma.service"

@Injectable()
export class LoginFromExternalWidget implements Widget {
    constructor(private readonly prisma: PrismaService) {}
    private config: Config = {
        publicConfig: {
            allowedDomains: ["localhost:3000", "localhost:8080", "localhost"],
            authEndpoint: "/auth/external",
        },
        privateConfig: {},
    }

    // Store user-specific credentials
    private userCredentials: Map<string, { accessKey: string; secretKey: string }> = new Map()

    async onSubscribe(userInfo: UserInfoDTO): Promise<void> {}

    async onUnsubscribe(userInfo: Record<string, any>): Promise<void> {}

    getConfig(): Config {
        return this.config
    }

    // Get credentials for a specific user
    getCredentials(username: string): { accessKey: string; secretKey: string } | null {
        return this.userCredentials.get(username) || null
    }

    // Method for authorized users to retrieve their credentials
    getUserCredentials(username: string): Record<string, any> {
        return this.config
    }

    // Method to validate login attempts with credentials
    validateCredentials(accessKey: string, secretKey: string): boolean {
        return false
    }

    async createConfig(config: Config): Promise<Config> {
        return this.config
    }

    async updateConfig(config: Config): Promise<Config> {
        return this.config
    }
}
