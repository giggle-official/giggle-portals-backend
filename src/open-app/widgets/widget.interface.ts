import { UserInfoDTO } from "src/user/user.controller"

export type PublicConfig = Record<string, any>

export type PrivateConfig = Record<string, any>

export type Config = {
    publicConfig: PublicConfig
    privateConfig: PrivateConfig
}

export interface Widget {
    onSubscribe(userInfo: UserInfoDTO): Promise<void>
    onUnsubscribe(userInfo: UserInfoDTO): Promise<void>
    getConfig(): Config
    createConfig(config: Config): Promise<Config>
    updateConfig(config: Config): Promise<Config>
}
