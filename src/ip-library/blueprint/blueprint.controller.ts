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

    @Post("/test-pdf")
    @ApiOperation({ summary: "Test PDF generation capabilities" })
    @ApiResponse({ status: 200, description: "PDF test result" })
    async testPdf(): Promise<{ success: boolean; message: string }> {
        try {
            const testResult = await this.blueprintService.testPdfGeneration()
            return {
                success: testResult,
                message: testResult ? "PDF generation test passed" : "PDF generation test failed",
            }
        } catch (error) {
            return {
                success: false,
                message: `PDF test failed: ${error.message}`,
            }
        }
    }
}
