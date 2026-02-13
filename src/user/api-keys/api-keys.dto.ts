import { PickType } from "@nestjs/swagger"
import { user_api_keys } from "@prisma/client"

export class ApiKeyDTO implements user_api_keys {
    id: number
    user: string
    api_key: string
    app_id: string
    discarded: boolean
    created_at: Date
    updated_at: Date
}

export class DisableApiKeyDTO extends PickType(ApiKeyDTO, ["id"]) { }
