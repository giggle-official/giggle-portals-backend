// Health check script for PDF generation in Docker
const puppeteer = require("puppeteer")

async function healthCheck() {
    let browser
    try {
        console.log("Starting PDF health check...")

        browser = await puppeteer.launch({
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--single-process",
                "--disable-gpu",
                "--disable-background-timer-throttling",
                "--disable-backgrounding-occluded-windows",
                "--disable-renderer-backgrounding",
            ],
        })

        const page = await browser.newPage()
        await page.setContent("<h1>Health Check</h1><p>PDF generation working!</p>")

        const pdf = await page.pdf({
            format: "A4",
            printBackground: true,
        })

        console.log("✅ PDF health check passed! Generated", pdf.length, "bytes")
        process.exit(0)
    } catch (error) {
        console.error("❌ PDF health check failed:", error.message)
        process.exit(1)
    } finally {
        if (browser) {
            await browser.close()
        }
    }
}

healthCheck()
