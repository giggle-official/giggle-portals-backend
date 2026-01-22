import { Injectable, Logger, NotFoundException } from "@nestjs/common"
import { Cron, CronExpression } from "@nestjs/schedule"
import { PrismaService } from "src/common/prisma.service"
import puppeteer, { Browser, Cookie, Page } from "puppeteer"

interface SiteConfig {
    name: string
    url: string
    waitTime: number // ms to wait after page load
    userAgent?: string
    extraSteps?: (page: Page) => Promise<void>
}

@Injectable()
export class CookieService {
    private readonly logger = new Logger(CookieService.name)

    // Site configurations
    private readonly siteConfigs: Record<string, SiteConfig> = {
        douyin: {
            name: "douyin",
            url: "https://www.douyin.com",
            waitTime: 5000,
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        bilibili: {
            name: "bilibili",
            url: "https://www.bilibili.com",
            waitTime: 3000,
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        twitter: {
            name: "twitter",
            url: "https://x.com",
            waitTime: 5000,
            userAgent:
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
    }

    constructor(private readonly prisma: PrismaService) { }

    /**
     * Cron job to refresh all site cookies every hour
     */
    @Cron(CronExpression.EVERY_HOUR)
    async refreshAllCookies(): Promise<void> {
        if (process.env.TASK_SLOT != "1") {
            return
        }

        this.logger.log("[refreshAllCookies] Starting cookie refresh for all sites...")

        for (const siteName of Object.keys(this.siteConfigs)) {
            try {
                await this.refreshSiteCookies(siteName)
                this.logger.log(`[refreshAllCookies] Successfully refreshed cookies for ${siteName}`)
            } catch (error) {
                this.logger.error(`[refreshAllCookies] Failed to refresh cookies for ${siteName}: ${error.message}`)
            }
        }

        this.logger.log("[refreshAllCookies] Completed cookie refresh for all sites")
    }

    /**
     * Refresh cookies for a specific site
     */
    async refreshSiteCookies(siteName: string): Promise<{ success: boolean; message: string }> {
        const config = this.siteConfigs[siteName.toLowerCase()]
        if (!config) {
            throw new NotFoundException(`Site "${siteName}" is not supported`)
        }

        this.logger.log(`[refreshSiteCookies] Refreshing cookies for ${siteName}...`)

        let browser: Browser | null = null

        try {
            browser = await puppeteer.launch({
                headless: true,
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--no-first-run",
                    "--no-zygote",
                    "--disable-gpu",
                    "--lang=zh-CN,zh",
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            })

            const page = await browser.newPage()

            // Set user agent
            if (config.userAgent) {
                await page.setUserAgent(config.userAgent)
            }

            // Set viewport
            await page.setViewport({ width: 1920, height: 1080 })

            // Set extra headers for Chinese sites
            await page.setExtraHTTPHeaders({
                "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            })

            this.logger.log(`[refreshSiteCookies] Navigating to ${config.url}...`)

            // Navigate to the site
            await page.goto(config.url, {
                waitUntil: "networkidle2",
                timeout: 60000,
            })

            // Wait for additional time to allow cookies to be set
            await this.sleep(config.waitTime)

            // Execute any site-specific steps
            if (config.extraSteps) {
                await config.extraSteps(page)
            }

            // Get cookies
            const cookies = await page.cookies()

            if (cookies.length === 0) {
                throw new Error("No cookies were captured")
            }

            // Convert to Netscape format
            const netscapeCookies = this.toNetscapeFormat(cookies, config.url)

            this.logger.log(`[refreshSiteCookies] Captured ${cookies.length} cookies for ${siteName}`)

            // Save to database
            await this.prisma.site_cookies.upsert({
                where: { site_name: siteName },
                update: {
                    cookies: netscapeCookies,
                    last_refresh: new Date(),
                    refresh_status: "success",
                    error_message: null,
                    updated_at: new Date(),
                },
                create: {
                    site_name: siteName,
                    site_url: config.url,
                    cookies: netscapeCookies,
                    last_refresh: new Date(),
                    refresh_status: "success",
                    error_message: null,
                },
            })

            return { success: true, message: `Successfully refreshed ${cookies.length} cookies for ${siteName}` }
        } catch (error) {
            this.logger.error(`[refreshSiteCookies] Error refreshing cookies for ${siteName}: ${error.message}`)

            // Update database with error status
            await this.prisma.site_cookies.upsert({
                where: { site_name: siteName },
                update: {
                    refresh_status: "failed",
                    error_message: error.message,
                    updated_at: new Date(),
                },
                create: {
                    site_name: siteName,
                    site_url: config.url,
                    cookies: "",
                    last_refresh: new Date(),
                    refresh_status: "failed",
                    error_message: error.message,
                },
            })

            throw error
        } finally {
            if (browser) {
                await browser.close()
            }
        }
    }

    /**
     * Get cookies for a specific site (returns Netscape format string)
     */
    async getCookies(siteName: string): Promise<string> {
        const record = await this.prisma.site_cookies.findUnique({
            where: { site_name: siteName.toLowerCase() },
        })

        if (!record || !record.cookies) {
            throw new NotFoundException(`Cookies for site "${siteName}" not found. Please trigger a refresh first.`)
        }

        return record.cookies
    }

    /**
     * Get cookie status for all sites
     */
    async getAllCookieStatus(): Promise<any[]> {
        const records = await this.prisma.site_cookies.findMany({
            select: {
                site_name: true,
                site_url: true,
                last_refresh: true,
                refresh_status: true,
                error_message: true,
                updated_at: true,
            },
        })

        // Add sites that haven't been refreshed yet
        const existingSites = new Set(records.map((r) => r.site_name))
        const allSites = Object.keys(this.siteConfigs)

        for (const siteName of allSites) {
            if (!existingSites.has(siteName)) {
                records.push({
                    site_name: siteName,
                    site_url: this.siteConfigs[siteName].url,
                    last_refresh: null,
                    refresh_status: "never_refreshed",
                    error_message: null,
                    updated_at: null,
                })
            }
        }

        return records
    }

    /**
     * Convert Puppeteer cookies to Netscape cookie format
     * This format is compatible with yt-dlp --cookies option
     */
    private toNetscapeFormat(cookies: Cookie[], siteUrl: string): string {
        const lines = [
            "# Netscape HTTP Cookie File",
            "# https://curl.haxx.se/docs/http-cookies.html",
            "# This file was generated by cookie-service",
            "",
        ]

        for (const cookie of cookies) {
            // Determine domain
            let domain = cookie.domain
            if (!domain.startsWith(".")) {
                // Extract domain from URL if cookie domain is empty
                try {
                    const url = new URL(siteUrl)
                    domain = cookie.domain || url.hostname
                } catch {
                    domain = cookie.domain
                }
            }

            const includeSubdomains = domain.startsWith(".") ? "TRUE" : "FALSE"
            const secure = cookie.secure ? "TRUE" : "FALSE"
            const expiry = cookie.expires ? Math.floor(cookie.expires) : 0

            // Netscape format: domain, include_subdomains, path, secure, expiry, name, value
            lines.push(
                [domain, includeSubdomains, cookie.path || "/", secure, expiry.toString(), cookie.name, cookie.value].join(
                    "\t",
                ),
            )
        }

        return lines.join("\n")
    }

    /**
     * Helper function to sleep
     */
    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }

    /**
     * Get list of supported sites
     */
    getSupportedSites(): string[] {
        return Object.keys(this.siteConfigs)
    }
}
