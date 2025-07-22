import { Injectable, Logger } from "@nestjs/common"
import * as puppeteer from "puppeteer"
import MarkdownIt from "markdown-it"

@Injectable()
export class PdfService {
    private readonly logger = new Logger(PdfService.name)
    private md: MarkdownIt
    private readonly isProduction: boolean

    constructor() {
        this.md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
        })
        this.isProduction = process.env.NODE_ENV === "production"

        if (this.isProduction) {
            this.logger.log("PDF Service initialized in production mode")
        }
    }

    async convertMarkdownToPdf(markdown: string, filename: string): Promise<Buffer> {
        const maxRetries = 3
        let lastError: Error

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                this.logger.log(`PDF generation attempt ${attempt}/${maxRetries} for ${filename}`)
                return await this.generatePdf(markdown, filename)
            } catch (error) {
                lastError = error
                this.logger.warn(`PDF generation attempt ${attempt} failed:`, error.message)

                if (attempt === maxRetries) {
                    this.logger.error(`All PDF generation attempts failed for ${filename}`)
                    throw lastError
                }

                // Wait before retry
                await new Promise((resolve) => setTimeout(resolve, 2000 * attempt))
            }
        }
    }

    private async generatePdf(markdown: string, filename: string): Promise<Buffer> {
        let browser: puppeteer.Browser | null = null

        try {
            // Convert markdown to HTML
            const html = this.md.render(markdown)

            // Create styled HTML document
            const styledHtml = this.createStyledHtml(html)

            // Launch puppeteer with Docker-compatible settings
            browser = await puppeteer.launch({
                headless: true,
                timeout: 60000, // 60 second timeout
                protocolTimeout: 60000, // 60 second protocol timeout
                args: [
                    "--no-sandbox",
                    "--disable-setuid-sandbox",
                    "--disable-dev-shm-usage",
                    "--disable-accelerated-2d-canvas",
                    "--no-first-run",
                    "--no-zygote",
                    "--single-process",
                    "--disable-gpu",
                    "--disable-web-security",
                    "--disable-features=VizDisplayCompositor",
                    "--disable-background-timer-throttling",
                    "--disable-backgrounding-occluded-windows",
                    "--disable-renderer-backgrounding",
                    "--disable-ipc-flooding-protection",
                    "--disable-extensions",
                    "--disable-default-apps",
                    "--disable-sync",
                    "--disable-translate",
                    "--disable-background-networking",
                    "--disable-background-downloads",
                    "--disable-component-extensions-with-background-pages",
                    "--disable-client-side-phishing-detection",
                    "--disable-domain-reliability",
                    "--disable-features=TranslateUI",
                    "--disable-hang-monitor",
                    "--disable-popup-blocking",
                    "--disable-prompt-on-repost",
                    "--disable-bundled-ppapi-flash",
                    "--disable-shared-worker",
                    "--disable-speech-api",
                    "--disable-file-system",
                    "--disable-presentation-api",
                    "--disable-permissions-api",
                    "--disable-new-bookmark-apps",
                    "--disable-office-editing-component-extension",
                    "--disable-offer-store-unmasked-wallet-cards",
                    "--disable-offer-upload-credit-cards",
                    "--disable-dev-tools",
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            })

            const page = await browser.newPage()

            // Set page timeouts
            await page.setDefaultTimeout(30000) // 30 second timeout
            await page.setDefaultNavigationTimeout(30000) // 30 second navigation timeout

            // Disable unnecessary features for PDF generation
            await page.setJavaScriptEnabled(false)
            await page.setCacheEnabled(false)

            // Set content with timeout
            await page.setContent(styledHtml, {
                waitUntil: "domcontentloaded", // Changed from networkidle0 to domcontentloaded for faster rendering
                timeout: 30000,
            })

            // Wait a bit for fonts to load
            await new Promise((resolve) => setTimeout(resolve, 1000))

            // Generate PDF
            const pdfBuffer = await page.pdf({
                format: "A4",
                printBackground: true,
                timeout: 30000, // 30 second timeout for PDF generation
                margin: {
                    top: "20mm",
                    right: "20mm",
                    bottom: "20mm",
                    left: "20mm",
                },
            })

            return Buffer.from(pdfBuffer)
        } catch (error) {
            const memUsage = process.memoryUsage()
            this.logger.error(`Error converting markdown to PDF: ${error.message}`)
            this.logger.error(
                `Memory usage - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            )

            if (error.message.includes("timeout") || error.message.includes("Protocol")) {
                throw new Error(`PDF generation timeout - try again later. Original error: ${error.message}`)
            }

            throw new Error(`Failed to convert markdown to PDF: ${error.message}`)
        } finally {
            if (browser) {
                try {
                    await browser.close()
                } catch (closeError) {
                    this.logger.warn("Error closing browser:", closeError.message)
                }
            }
        }
    }

    // Test method for debugging
    async testPdfGeneration(): Promise<boolean> {
        try {
            this.logger.log("Testing PDF generation capabilities...")
            const testMarkdown = "# Test\n\nThis is a test document."
            const buffer = await this.generatePdf(testMarkdown, "test.pdf")
            this.logger.log(`PDF test successful - generated ${buffer.length} bytes`)
            return true
        } catch (error) {
            this.logger.error("PDF test failed:", error.message)
            return false
        }
    }

    private createStyledHtml(content: string): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>IP Blueprint</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #1a202c;
            max-width: 800px;
            margin: 0 auto;
            padding: 40px;
            background-color: #ffffff;
        }
        
        h1 {
            color: #667eea;
            font-size: 28px;
            font-weight: 700;
            margin-bottom: 8px;
            padding-bottom: 12px;
            border-bottom: 3px solid #667eea;
        }
        
        h2 {
            color: #4a5568;
            font-size: 20px;
            font-weight: 600;
            margin-top: 32px;
            margin-bottom: 16px;
            padding-left: 12px;
            border-left: 4px solid #667eea;
        }
        
        h3 {
            color: #2d3748;
            font-size: 16px;
            font-weight: 600;
            margin-top: 24px;
            margin-bottom: 12px;
        }
        
        p {
            margin-bottom: 16px;
            color: #2d3748;
        }
        
        ul, ol {
            margin-bottom: 16px;
            padding-left: 24px;
        }
        
        li {
            margin-bottom: 8px;
            color: #2d3748;
        }
        
        strong {
            color: #1a202c;
            font-weight: 600;
        }
        
        code {
            background-color: #f7fafc;
            color: #667eea;
            padding: 2px 6px;
            border-radius: 4px;
            font-size: 14px;
        }
        
        blockquote {
            border-left: 4px solid #667eea;
            background-color: #f7fafc;
            padding: 16px 20px;
            margin: 20px 0;
            font-style: italic;
            color: #4a5568;
        }
        
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        
        th, td {
            border: 1px solid #e2e8f0;
            padding: 12px;
            text-align: left;
        }
        
        th {
            background-color: #f7fafc;
            font-weight: 600;
            color: #4a5568;
        }
        
        .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border-radius: 12px;
            margin: -40px -40px 40px -40px;
        }
        
        .header h1 {
            color: white;
            border-bottom: none;
            margin-bottom: 8px;
        }
        
        .subtitle {
            font-size: 16px;
            opacity: 0.9;
            margin: 0;
        }
        
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
            text-align: center;
            font-size: 14px;
            color: #718096;
        }
        
        @media print {
            body {
                padding: 20px;
            }
            .header {
                margin: -20px -20px 30px -20px;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Your IP Blueprint</h1>
        <p class="subtitle">AI-generated tokenization strategy</p>
    </div>
    
    ${content}
    
    <div class="footer">
        <p>Generated on ${new Date().toLocaleDateString()} | Powered by Giggle.pro</p>
    </div>
</body>
</html>`
    }
}
