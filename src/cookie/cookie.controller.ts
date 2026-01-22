import { Controller, Get, Param, Post, Res, HttpStatus, Logger, UseGuards } from "@nestjs/common"
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
     */
    @Get(":siteName")
    @ApiOperation({ summary: "Get cookies for a specific site as a .txt file" })
    @ApiParam({ name: "siteName", description: "Site name (douyin, bilibili, twitter)" })
    @ApiResponse({ status: 200, description: "Cookie file" })
    @ApiResponse({ status: 404, description: "Cookies not found" })
    @UseGuards(IsWidgetGuard)
    async getCookiesFile(@Param("siteName") siteName: string, @Res() res: Response): Promise<void> {
        try {
            const cookies = await this.cookieService.getCookies(siteName)

            // Set headers for file download
            res.setHeader("Content-Type", "text/plain; charset=utf-8")
            res.setHeader("Content-Disposition", `attachment; filename="${siteName}_cookies.txt"`)
            res.status(HttpStatus.OK).send(cookies)
        } catch (error) {
            this.logger.error(`[getCookiesFile] Error getting cookies for ${siteName}: ${error.message}`)
            res.status(HttpStatus.NOT_FOUND).json({
                statusCode: HttpStatus.NOT_FOUND,
                message: error.message,
            })
        }
    }

    /**
     * Manually trigger cookie refresh for a specific site
     */
    @Post(":siteName/refresh")
    @ApiOperation({ summary: "Manually trigger cookie refresh for a specific site" })
    @ApiParam({ name: "siteName", description: "Site name (douyin, bilibili, twitter)" })
    @ApiResponse({ status: 200, description: "Refresh successful" })
    @ApiResponse({ status: 500, description: "Refresh failed" })
    @UseGuards(IsWidgetGuard)
    async refreshCookies(@Param("siteName") siteName: string, @Res() res: Response): Promise<void> {
        try {
            this.logger.log(`[refreshCookies] Manual refresh triggered for ${siteName}`)
            const result = await this.cookieService.refreshSiteCookies(siteName)
            res.status(HttpStatus.OK).json(result)
        } catch (error) {
            this.logger.error(`[refreshCookies] Error refreshing cookies for ${siteName}: ${error.message}`)
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                success: false,
                message: error.message,
            })
        }
    }

    /**
     * Manually trigger cookie refresh for all sites
     */
    @Post("refresh-all")
    @ApiOperation({ summary: "Manually trigger cookie refresh for all sites" })
    @ApiResponse({ status: 200, description: "Refresh initiated" })
    @UseGuards(IsWidgetGuard)
    async refreshAllCookies(@Res() res: Response): Promise<void> {
        try {
            this.logger.log("[refreshAllCookies] Manual refresh triggered for all sites")

            // Run in background, don't wait
            this.cookieService.refreshAllCookies().catch((err) => {
                this.logger.error(`[refreshAllCookies] Background refresh error: ${err.message}`)
            })

            res.status(HttpStatus.OK).json({
                success: true,
                message: "Cookie refresh initiated for all sites",
            })
        } catch (error) {
            this.logger.error(`[refreshAllCookies] Error: ${error.message}`)
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                success: false,
                message: error.message,
            })
        }
    }

    /**
     * Get status of all site cookies
     */
    @Get("")
    @ApiOperation({ summary: "Get status of all site cookies" })
    @ApiResponse({ status: 200, description: "Cookie status list" })
    @UseGuards(IsWidgetGuard)
    async getCookieStatus(@Res() res: Response): Promise<void> {
        try {
            const status = await this.cookieService.getAllCookieStatus()
            res.status(HttpStatus.OK).json({
                success: true,
                supported_sites: this.cookieService.getSupportedSites(),
                data: status,
            })
        } catch (error) {
            this.logger.error(`[getCookieStatus] Error: ${error.message}`)
            res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
                statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
                success: false,
                message: error.message,
            })
        }
    }
}
