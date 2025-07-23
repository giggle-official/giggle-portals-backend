import { Injectable, Logger } from "@nestjs/common"
import MarkdownIt from "markdown-it"
import PDFDocument from "pdfkit"
import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import mdToPdf from "md-to-pdf"
import { v4 as uuidv4 } from "uuid"

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

    async convertMarkdownToPdf(markdown: string): Promise<Buffer> {
        //get template path
        const tempFileName = uuidv4()
        const pdfPath = path.join(os.tmpdir(), `${tempFileName}.pdf`)
        const pdf = await mdToPdf(
            {
                content: markdown,
            },
            {
                launch_options: {
                    args: [
                        "--no-sandbox",
                        "--disable-setuid-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-gpu",
                        "--font-render-hinting=none",
                        "--disable-font-subpixel-positioning",
                    ],
                },
                css: `
                    body {
                        font-family: "SimSun", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
                        line-height: 1.6;
                        color: #333;
                    }
                    h1, h2, h3, h4, h5, h6 {
                        font-family: "SimHei", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
                        color: #2c3e50;
                    }
                    table {
                        font-family: "SimSun", "Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", sans-serif;
                    }
                `,
                pdf_options: {
                    format: "A4",
                    margin: {
                        top: "20mm",
                        bottom: "20mm",
                        left: "20mm",
                        right: "20mm",
                    },
                    printBackground: true,
                },
            },
        )
        if (pdf) {
            fs.writeFileSync(pdfPath, pdf.content)
        }
        return fs.readFileSync(pdfPath)
        //const maxRetries = 3
        //let lastError: Error
        //
        //for (let attempt = 1; attempt <= maxRetries; attempt++) {
        //    try {
        //        this.logger.log(`PDF generation attempt ${attempt}/${maxRetries} for ${filename}`)
        //        return await this.generatePdf(markdown, filename)
        //    } catch (error) {
        //        lastError = error
        //        this.logger.warn(`PDF generation attempt ${attempt} failed:`, error.message)
        //
        //        if (attempt === maxRetries) {
        //            this.logger.error(`All PDF generation attempts failed for ${filename}`)
        //            throw lastError
        //        }
        //
        //        // Wait before retry
        //        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
        //    }
        //}
    }

    private async generatePdf(markdown: string, filename: string): Promise<Buffer> {
        try {
            const doc = new PDFDocument({
                size: "A4",
                margins: {
                    top: 72, // ~20mm
                    bottom: 72,
                    left: 72,
                    right: 72,
                },
            })

            const chunks: Buffer[] = []

            // Collect PDF data
            doc.on("data", (chunk) => chunks.push(chunk))

            // Add header
            this.addHeader(doc)

            // Parse markdown and render to PDF
            const tokens = this.md.parse(markdown, {})
            await this.renderTokensToPdf(doc, tokens)

            // Add footer
            this.addFooter(doc)

            // Finalize PDF
            doc.end()

            // Return promise that resolves when PDF is complete
            return new Promise((resolve, reject) => {
                doc.on("end", () => {
                    try {
                        const pdfBuffer = Buffer.concat(chunks)
                        this.logger.log(`PDF generated successfully: ${pdfBuffer.length} bytes`)
                        resolve(pdfBuffer)
                    } catch (error) {
                        reject(error)
                    }
                })

                doc.on("error", reject)
            })
        } catch (error) {
            const memUsage = process.memoryUsage()
            this.logger.error(`Error converting markdown to PDF: ${error.message}`)
            this.logger.error(
                `Memory usage - RSS: ${Math.round(memUsage.rss / 1024 / 1024)}MB, Heap: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
            )
            throw new Error(`Failed to convert markdown to PDF: ${error.message}`)
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

    private addHeader(doc: PDFKit.PDFDocument): void {
        // Header background (simulate gradient with rectangle)
        doc.rect(0, 0, doc.page.width, 120).fillAndStroke("#667eea", "#764ba2")

        // Header text
        doc.fillColor("white")
            .fontSize(24)
            .font("Helvetica-Bold")
            .text("Your IP Blueprint", 72, 30, { align: "center" })
            .fontSize(14)
            .font("Helvetica")
            .text("AI-generated tokenization strategy", 72, 65, { align: "center" })

        // Move cursor down
        doc.y = 150
        doc.fillColor("#1a202c") // Reset text color
    }

    private addFooter(doc: PDFKit.PDFDocument): void {
        const pageHeight = doc.page.height

        // Add some space before footer
        doc.y = pageHeight - 100

        // Footer line
        doc.strokeColor("#e2e8f0")
            .lineWidth(1)
            .moveTo(72, doc.y)
            .lineTo(doc.page.width - 72, doc.y)
            .stroke()

        // Footer text
        doc.y += 20
        doc.fillColor("#718096")
            .fontSize(10)
            .font("Helvetica")
            .text(`Generated on ${new Date().toLocaleDateString()} | Powered by Giggle.pro`, 72, doc.y, {
                align: "center",
            })
    }

    private async renderTokensToPdf(doc: PDFKit.PDFDocument, tokens: any[]): Promise<void> {
        let currentFontSize = 12
        let currentFont = "Helvetica"
        let currentColor = "#2d3748"
        let inList = false
        let listLevel = 0
        let inTable = false
        let tableData: string[][] = []
        let currentRow: string[] = []

        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i]

            switch (token.type) {
                case "heading_open":
                    const level = parseInt(token.tag.slice(1))
                    this.addSpacing(doc, level === 1 ? 20 : 15)

                    if (level === 1) {
                        currentFontSize = 20
                        currentColor = "#667eea"
                        currentFont = "Helvetica-Bold"
                    } else if (level === 2) {
                        currentFontSize = 16
                        currentColor = "#4a5568"
                        currentFont = "Helvetica-Bold"
                    } else {
                        currentFontSize = 14
                        currentColor = "#2d3748"
                        currentFont = "Helvetica-Bold"
                    }

                    doc.fontSize(currentFontSize).font(currentFont).fillColor(currentColor)
                    break

                case "heading_close":
                    const headingLevel = parseInt(tokens[i - 2]?.tag?.slice(1) || "1")
                    if (headingLevel === 1) {
                        // Add underline for h1
                        const textWidth = doc.widthOfString(tokens[i - 1]?.content || "")
                        doc.strokeColor("#667eea")
                            .lineWidth(2)
                            .moveTo(72, doc.y + 5)
                            .lineTo(72 + textWidth, doc.y + 5)
                            .stroke()
                    } else if (headingLevel === 2) {
                        // Add left border for h2
                        doc.rect(72, doc.y - currentFontSize - 5, 4, currentFontSize + 5).fillAndStroke("#667eea")
                    }

                    this.addSpacing(doc, 10)
                    this.resetTextStyle(doc)
                    break

                case "paragraph_open":
                    if (!inList && !inTable) {
                        this.addSpacing(doc, 5)
                    }
                    doc.fontSize(12).font("Helvetica").fillColor("#2d3748")
                    break

                case "paragraph_close":
                    if (!inList && !inTable) {
                        this.addSpacing(doc, 12)
                    }
                    break

                case "bullet_list_open":
                    inList = true
                    listLevel++
                    this.addSpacing(doc, 5)
                    break

                case "bullet_list_close":
                    inList = false
                    listLevel--
                    this.addSpacing(doc, 12)
                    break

                case "ordered_list_open":
                    inList = true
                    listLevel++
                    this.addSpacing(doc, 6)
                    break

                case "ordered_list_close":
                    inList = false
                    listLevel--
                    this.addSpacing(doc, 12)
                    break

                case "list_item_open":
                    this.addSpacing(doc, 3)
                    // We'll handle the bullet when we get the content
                    break

                case "list_item_close":
                    // Spacing is now handled in renderListItem based on actual text height
                    break

                case "inline":
                    if (inTable) {
                        currentRow.push(token.content || "")
                    } else if (inList) {
                        this.renderListItem(doc, token.content, listLevel)
                    } else {
                        this.renderInlineContent(doc, token.content)
                    }
                    break

                case "text":
                    if (inTable) {
                        // Text inside table cell
                        if (currentRow.length === 0) {
                            currentRow.push(token.content || "")
                        } else {
                            currentRow[currentRow.length - 1] += token.content || ""
                        }
                    } else if (inList) {
                        this.renderListItem(doc, token.content, listLevel)
                    } else {
                        doc.text(token.content, { continued: false })
                    }
                    break

                case "blockquote_open":
                    this.addSpacing(doc, 10)
                    // Add quote background
                    const quoteY = doc.y
                    doc.rect(72, quoteY, 4, 20) // Left border
                        .fillAndStroke("#667eea")
                    doc.rect(76, quoteY, doc.page.width - 148, 20).fillAndStroke("#f7fafc")
                    doc.x = 90
                    doc.y = quoteY + 5
                    doc.fontSize(11).font("Helvetica-Oblique").fillColor("#4a5568")
                    break

                case "blockquote_close":
                    this.addSpacing(doc, 15)
                    this.resetTextStyle(doc)
                    break

                case "table_open":
                    inTable = true
                    tableData = []
                    this.addSpacing(doc, 10)
                    break

                case "table_close":
                    inTable = false
                    this.renderTable(doc, tableData)
                    tableData = []
                    this.addSpacing(doc, 10)
                    break

                case "thead_open":
                case "tbody_open":
                case "thead_close":
                case "tbody_close":
                    // Just markers, no action needed
                    break

                case "tr_open":
                    currentRow = []
                    break

                case "tr_close":
                    if (currentRow.length > 0) {
                        tableData.push([...currentRow])
                    }
                    break

                case "th_open":
                case "td_open":
                case "th_close":
                case "td_close":
                    // Content is handled in inline/text tokens
                    break

                case "hr":
                    this.addSpacing(doc, 10)
                    doc.strokeColor("#e2e8f0")
                        .lineWidth(1)
                        .moveTo(72, doc.y)
                        .lineTo(doc.page.width - 72, doc.y)
                        .stroke()
                    this.addSpacing(doc, 10)
                    break
            }

            // Check for page break
            if (doc.y > doc.page.height - 100) {
                doc.addPage()
                doc.y = 72
            }
        }
    }

    private renderListItem(doc: PDFKit.PDFDocument, content: string, listLevel: number): void {
        const indent = 72 + (listLevel - 1) * 20
        const bulletIndent = indent
        const textIndent = indent + 15

        // Save current position
        const startY = doc.y

        // Draw bullet at current position
        doc.text("•", bulletIndent, startY, { continued: false })

        // Reset position and render text with proper width constraint
        doc.x = textIndent
        doc.y = startY

        // Calculate available width for text
        const availableWidth = doc.page.width - textIndent - 72

        // Calculate the height of the content first
        const textHeight = doc.heightOfString(content.trim(), {
            width: availableWidth,
        })

        // Render formatted text with width constraint
        const parts = content.trim().split(/(\*\*.*?\*\*)/g)

        for (const part of parts) {
            if (part.startsWith("**") && part.endsWith("**")) {
                const boldText = part.slice(2, -2)
                if (boldText.length > 0) {
                    doc.font("Helvetica-Bold").text(boldText, {
                        continued: true,
                        width: availableWidth,
                    })
                }
            } else if (part.length > 0) {
                doc.font("Helvetica").text(part, {
                    continued: true,
                    width: availableWidth,
                })
            }
        }

        // End the line
        doc.text("", { continued: false })

        // Update Y position based on actual text height to prevent overlapping
        const minLineHeight = 14 // Minimum line height
        const actualHeight = Math.max(textHeight, minLineHeight)
        doc.y = startY + actualHeight + 2 // Add 2px spacing after list item
    }

    private renderInlineContent(doc: PDFKit.PDFDocument, content: string): void {
        // Parse and render inline formatting
        this.renderFormattedText(doc, content)
    }

    private renderFormattedText(doc: PDFKit.PDFDocument, text: string): void {
        // Split text by bold markers
        const parts = text.split(/(\*\*.*?\*\*)/g)

        let hasContent = false
        const startY = doc.y

        for (const part of parts) {
            if (part.startsWith("**") && part.endsWith("**")) {
                // This is bold text
                const boldText = part.slice(2, -2) // Remove ** from both ends
                if (boldText.length > 0) {
                    doc.font("Helvetica-Bold").text(boldText, { continued: true })
                    hasContent = true
                }
            } else if (part.length > 0) {
                // Regular text
                doc.font("Helvetica").text(part, { continued: true })
                hasContent = true
            }
        }

        // Add line break after the formatted text only if there was content
        if (hasContent) {
            doc.text("", { continued: false })

            // Calculate and add the actual height of the rendered text
            const textHeight = doc.heightOfString(text, {
                width: doc.page.width - doc.x - 72,
            })

            // Ensure minimum line height and add some spacing
            const minLineHeight = 14 // Base line height for 12px font
            const lineHeight = Math.max(textHeight, minLineHeight)
            doc.y = startY + lineHeight + 3 // Add 3px spacing between lines
        }
    }

    private renderFormattedTextInCell(
        doc: PDFKit.PDFDocument,
        text: string,
        maxWidth: number,
        maxHeight: number,
    ): void {
        // Split text by bold markers
        const parts = text.split(/(\*\*.*?\*\*)/g)

        for (const part of parts) {
            if (part.startsWith("**") && part.endsWith("**")) {
                // This is bold text
                const boldText = part.slice(2, -2) // Remove ** from both ends
                doc.font("Helvetica-Bold").text(boldText, {
                    continued: true,
                    width: maxWidth,
                    align: "left",
                })
            } else if (part.length > 0) {
                // Regular text
                doc.font("Helvetica").text(part, {
                    continued: true,
                    width: maxWidth,
                    align: "left",
                })
            }
        }

        // End the text without line break for cell content
        doc.text("", { continued: false })
    }

    private renderTable(doc: PDFKit.PDFDocument, tableData: string[][]): void {
        if (tableData.length === 0) return

        const startX = 72
        const tableWidth = doc.page.width - 144
        const cols = tableData[0].length
        const colWidth = tableWidth / cols
        const cellPadding = 8
        const minRowHeight = 30

        let currentY = doc.y

        // Calculate row heights based on content
        const rowHeights = tableData.map((row, rowIndex) => {
            let maxHeight = minRowHeight

            row.forEach((cell) => {
                const isHeader = rowIndex === 0
                doc.fontSize(isHeader ? 11 : 10)
                doc.font(isHeader ? "Helvetica-Bold" : "Helvetica")

                // Calculate text height for this cell
                const textHeight = doc.heightOfString(cell || "", {
                    width: colWidth - cellPadding * 2,
                })

                const requiredHeight = textHeight + cellPadding * 2
                if (requiredHeight > maxHeight) {
                    maxHeight = requiredHeight
                }
            })

            return maxHeight
        })

        tableData.forEach((row, rowIndex) => {
            const rowHeight = rowHeights[rowIndex]

            // Check if we need a new page
            if (currentY + rowHeight > doc.page.height - 100) {
                doc.addPage()
                currentY = 72
            }

            // Draw row background for header
            if (rowIndex === 0) {
                doc.rect(startX, currentY, tableWidth, rowHeight).fillAndStroke("#f7fafc", "#e2e8f0")
            }

            // Draw cell borders first
            row.forEach((cell, colIndex) => {
                const cellX = startX + colIndex * colWidth
                doc.rect(cellX, currentY, colWidth, rowHeight).stroke("#e2e8f0")
            })

            // Draw cell content
            row.forEach((cell, colIndex) => {
                const cellX = startX + colIndex * colWidth
                const isHeader = rowIndex === 0

                doc.fontSize(isHeader ? 11 : 10).fillColor(isHeader ? "#4a5568" : "#2d3748")

                // Position cursor for cell content
                doc.x = cellX + cellPadding
                doc.y = currentY + cellPadding

                if (isHeader) {
                    // Headers are always bold
                    doc.font("Helvetica-Bold").text(cell || "", {
                        width: colWidth - cellPadding * 2,
                        height: rowHeight - cellPadding * 2,
                        align: "left",
                        continued: false,
                    })
                } else {
                    // Regular cells with proper wrapping
                    this.renderFormattedTextInCell(
                        doc,
                        cell || "",
                        colWidth - cellPadding * 2,
                        rowHeight - cellPadding * 2,
                    )
                }
            })

            currentY += rowHeight
        })

        // Update document Y position
        doc.y = currentY + 10
        this.resetTextStyle(doc)
    }

    private addSpacing(doc: PDFKit.PDFDocument, points: number): void {
        doc.y += points
    }

    private resetTextStyle(doc: PDFKit.PDFDocument): void {
        doc.fontSize(12).font("Helvetica").fillColor("#2d3748").x = 72
    }
}
