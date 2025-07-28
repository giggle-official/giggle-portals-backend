import { Controller, Post, Body } from "@nestjs/common"
import { ApiOperation, ApiBody, ApiResponse, ApiTags } from "@nestjs/swagger"
import { BlueprintResponseDto, GenerateBlueprintDto } from "./blueprint.dto"
import { BlueprintService } from "./blueprint.service"

@Controller("/api/v1/ip-library/blueprint")
@ApiTags("IP Library")
export class BlueprintController {
    constructor(private readonly blueprintService: BlueprintService) {}

    @Post("/generate")
    @ApiOperation({ summary: "Generate blueprint for an ip library" })
    @ApiBody({ type: GenerateBlueprintDto })
    @ApiResponse({ type: BlueprintResponseDto, status: 200 })
    async generateBlueprint(@Body() dto: GenerateBlueprintDto): Promise<BlueprintResponseDto> {
        return this.blueprintService.generateBlueprint(dto)
    }
}
