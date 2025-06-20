import { ForbiddenException, Injectable, OnModuleInit } from "@nestjs/common"
import { UserJwtExtractDto } from "../user/user.controller"
import path from "path"
import fs from "fs"

@Injectable()
export class DocsService implements OnModuleInit {
    private publicDocument: any

    async onModuleInit() {
        this.initializePublicDocument()
    }

    private initializePublicDocument() {}

    getContent(userInfo: UserJwtExtractDto) {
        if (!userInfo.is_developer) {
            throw new ForbiddenException("You are not authorized to access this resource")
        }
        const spec = fs.readFileSync(path.join(process.cwd(), "openapi-public-spec.json"), "utf8")
        const specJson = JSON.parse(spec)
        //filter with tags
        const availableTags = specJson["x-tagGroups"].flatMap((tagGroup: any) => tagGroup.tags)
        let filteredPaths = {}
        const allKeys = Object.keys(specJson.paths)
        allKeys.map((key) => {
            const methods = Object.keys(specJson.paths[key])
            methods.map((method) => {
                if (specJson.paths[key][method]?.tags?.some((tag: string[]) => availableTags.includes(tag))) {
                    filteredPaths[key] = {
                        [method]: specJson.paths[key][method],
                    }
                }
            })
        })
        return {
            ...specJson,
            paths: filteredPaths,
        }
    }
}
