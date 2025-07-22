// Simple test script for PDF generation
const { PdfService } = require("./dist/common/pdf.service")

const testMarkdown = `# Test IP Blueprint

## Token Strategy
- **Type**: Utility Token with Custom Features
- **Supply**: 1,000,000 tokens
- **Target**: $20,000 USDC

## Audience Fit
- **Current Reach**: 10k-50k
- **IP Category**: Music
- **Growth Potential**: High

## Recommended Widgets
- AvatarEarn
- AMV

This is a test of the PDF generation system.`

async function testPdf() {
    try {
        console.log("Testing PDF generation...")
        const pdfService = new PdfService()
        const buffer = await pdfService.convertMarkdownToPdf(testMarkdown, "test.pdf")
        console.log("PDF generated successfully! Size:", buffer.length, "bytes")

        // Save to file for inspection
        const fs = require("fs")
        fs.writeFileSync("test-output.pdf", buffer)
        console.log("PDF saved as test-output.pdf")
    } catch (error) {
        console.error("PDF generation failed:", error)
        process.exit(1)
    }
}

testPdf()
