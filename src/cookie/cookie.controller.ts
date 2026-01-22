import { Controller, Get, Param, Post, Res, HttpStatus, HttpCode, Logger, UseGuards } from "@nestjs/common"
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger"
import { Response } from "express"
import { CookieService } from "./cookie.service"
import { IsWidgetGuard } from "src/auth/is_widget.guard"

@ApiTags("Cookie")
@Controller("/api/v1/cookies")
export class CookieController {
    private readonly logger = new Logger(CookieController.name)

    constructor(private readonly cookieService: CookieService) { }

    /**
     * Get cookies for a specific site as a downloadable .txt file
     * Note: Using @Res() here because we need dynamic Content-Disposition header
     */
    @Get(":siteName")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Get cookies for a specific site as a .txt file" })
    @ApiParam({ name: "siteName", description: "Site name (douyin, bilibili, twitter)" })
    @ApiResponse({ status: 200, description: "Cookie file" })
    @ApiResponse({ status: 404, description: "Cookies not found" })
    @UseGuards(IsWidgetGuard)
    async getCookiesFile(@Param("siteName") siteName: string, @Res() res: Response): Promise<void> {
        const cookies = await this.cookieService.getCookies(siteName)
        res.setHeader("Content-Type", "text/plain; charset=utf-8")
        res.setHeader("Content-Disposition", `attachment; filename="${siteName}_cookies.txt"`)
        res.status(HttpStatus.OK).send(cookies)
    }

    /**
     * Manually trigger cookie refresh for a specific site
     */
    @Post(":siteName/refresh")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Manually trigger cookie refresh for a specific site" })
    @ApiParam({ name: "siteName", description: "Site name (douyin, bilibili, twitter)" })
    @ApiResponse({ status: 200, description: "Refresh successful" })
    @UseGuards(IsWidgetGuard)
    async refreshCookies(@Param("siteName") siteName: string) {
        this.logger.log(`[refreshCookies] Manual refresh triggered for ${siteName}`)
        return await this.cookieService.refreshSiteCookies(siteName)
    }

    /**
     * Manually trigger cookie refresh for all sites
     */
    @Post("refresh-all")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Manually trigger cookie refresh for all sites" })
    @ApiResponse({ status: 200, description: "Refresh initiated" })
    @UseGuards(IsWidgetGuard)
    async refreshAllCookies() {
        this.logger.log("[refreshAllCookies] Manual refresh triggered for all sites")

        // Run in background, don't wait
        this.cookieService.refreshAllCookies().catch((err) => {
            this.logger.error(`[refreshAllCookies] Background refresh error: ${err.message}`)
        })

        return {
            success: true,
            message: "Cookie refresh initiated for all sites",
        }
    }

    /**
     * Get status of all site cookies
     */
    @Get("")
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Get status of all site cookies" })
    @ApiResponse({ status: 200, description: "Cookie status list" })
    @UseGuards(IsWidgetGuard)
    async getCookieStatus() {
        const status = await this.cookieService.getAllCookieStatus()
        return {
            success: true,
            supported_sites: this.cookieService.getSupportedSites(),
            data: status,
        }
    }
}
