import { Controller, Get, HttpCode, HttpStatus, Post, Body } from "@nestjs/common"
import { ApiBody, ApiExcludeEndpoint, ApiOperation, ApiResponse, ApiResponseProperty } from "@nestjs/swagger"

@Controller({ path: "api/healthz" })
export class AppController {
    @Get()
    @HttpCode(HttpStatus.OK)
    @ApiExcludeEndpoint()
    async health() {
        return {
            status: "ok",
        }
    }

    @Post("/timeoutTest")
    @ApiOperation({ summary: "Timeout test", tags: ["Test Tools"] })
    @ApiResponse({
        status: 200,
        description: "Timeout test success",
        schema: {
            type: "object",
            properties: {
                status: { type: "string", example: "Timeout 30s, test success" },
            },
        },
    })
    @HttpCode(HttpStatus.OK)
    @ApiBody({
        schema: {
            type: "object",
            properties: {
                timeout: { type: "number", example: 30, description: "Timeout in seconds" },
            },
        },
    })
    async timeoutTest(@Body() body: { timeout: number }) {
        await new Promise((resolve) => setTimeout(resolve, body.timeout * 1000))
        return {
            status: `Timeout ${body.timeout}s, test success`,
        }
    }
}
