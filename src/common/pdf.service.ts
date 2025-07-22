import { Injectable, Logger } from "@nestjs/common"
import * as puppeteer from "puppeteer"
import MarkdownIt from "markdown-it"

@Injectable()
export class PdfService {
    private readonly logger = new Logger(PdfService.name)
    private md: MarkdownIt

    constructor() {
        this.md = new MarkdownIt({
            html: true,
            linkify: true,
            typographer: true,
        })
    }

    async convertMarkdownToPdf(markdown: string, filename: string): Promise<Buffer> {
        let browser: puppeteer.Browser | null = null

        try {
            // Convert markdown to HTML
            const html = this.md.render(markdown)

            // Create styled HTML document
            const styledHtml = this.createStyledHtml(html)

            // Launch puppeteer with Docker-compatible settings
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
                ],
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            })

            const page = await browser.newPage()

            // Set content
            await page.setContent(styledHtml, {
                waitUntil: "networkidle0",
            })

            // Generate PDF
            const pdfBuffer = await page.pdf({
                format: "A4",
                printBackground: true,
                margin: {
                    top: "20mm",
                    right: "20mm",
                    bottom: "20mm",
                    left: "20mm",
                },
            })

            return Buffer.from(pdfBuffer)
        } catch (error) {
            this.logger.error("Error converting markdown to PDF:", error)
            throw new Error("Failed to convert markdown to PDF")
        } finally {
            if (browser) {
                await browser.close()
            }
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
