import { BadRequestException, Injectable, Logger } from "@nestjs/common"
import { HttpService } from "@nestjs/axios"
import { v4 as uuidv4 } from "uuid"
import { firstValueFrom, lastValueFrom } from "rxjs"
import axios, { AxiosResponse } from "axios"
import { HttpsProxyAgent } from "https-proxy-agent"
import https from "https"
import { BlueprintResponseDto, DifyResponseDto, GenerateBlueprintDto } from "./blueprint.dto"
import { NotificationService } from "src/notification/notification.service"
import { PdfService } from "src/common/pdf.service"

@Injectable()
export class BlueprintService {
    private readonly logger = new Logger(BlueprintService.name)
    private readonly difyApiUrl: string
    private readonly difyApiKey: string
    private readonly difyHttpHeaders: Record<string, string>
    private readonly difyRequestService: HttpService

    constructor(
        private readonly notificationService: NotificationService,
        private readonly pdfService: PdfService,
    ) {
        this.difyApiUrl = process.env.DIFY_API_ENDPOINT
        this.difyApiKey = process.env.DIFY_APP_KEY
        if (!this.difyApiUrl || !this.difyApiKey) {
            this.logger.error("DIFY_API_ENDPOINT or DIFY_API_KEY is not set")
            throw new Error("DIFY_API_ENDPOINT or DIFY_API_KEY is not set")
        }
        this.difyHttpHeaders = {
            Authorization: `Bearer ${this.difyApiKey}`,
            "Content-Type": "application/json",
        }

        if (process.env.HTTP_PROXY) {
            this.difyRequestService = new HttpService(
                axios.create({
                    httpsAgent: new HttpsProxyAgent(process.env.HTTP_PROXY),
                }),
            )
        } else {
            this.difyRequestService = new HttpService(
                axios.create({
                    httpsAgent: new https.Agent(),
                }),
            )
        }
    }

    async generateBlueprint(dto: GenerateBlueprintDto): Promise<BlueprintResponseDto> {
        const unique_user_id = uuidv4()
        try {
            const requestBody = {
                inputs: {
                    user_input: dto.prompt,
                },
                response_mode: "blocking",
                user: unique_user_id,
            }
            const response: AxiosResponse<DifyResponseDto> = await lastValueFrom(
                this.difyRequestService.post(this.difyApiUrl, requestBody, { headers: this.difyHttpHeaders }),
            )

            // Get markdown content from response
            const markdownContent = response?.data?.data?.outputs?.text?.toString()

            if (!markdownContent) {
                this.logger.error(`dify api response failed: no content returned`)
                throw new BadRequestException(`dify api response failed: no content returned`)
            }

            // Create response object
            let res: BlueprintResponseDto = {
                status: "ok",
                email_sent: false,
            }

            // Send email with PDF if email provided
            if (dto?.email) {
                try {
                    // Convert markdown to PDF
                    const timestamp = new Date().toISOString().split("T")[0]
                    const pdfFilename = `IP-Blueprint-${timestamp}.pdf`
                    const pdfBuffer = await this.pdfService.convertMarkdownToPdf(markdownContent, pdfFilename)

                    // Send email with PDF attachment
                    await this.notificationService.sendNotificationWithPdf(
                        "Your IP Blueprint - AI-generated tokenization strategy",
                        dto.email,
                        "ip_blueprint_pdf",
                        {
                            user_email: dto.email,
                            generated_date: new Date().toLocaleDateString(),
                        },
                        pdfBuffer,
                        pdfFilename,
                    )

                    res.email_sent = true
                    this.logger.log(`Blueprint PDF sent successfully to ${dto.email}`)
                } catch (emailError) {
                    this.logger.error(`Failed to send blueprint PDF to ${dto.email}:`, emailError)
                    res.email_sent = false
                }
            }

            return res
        } catch (error) {
            this.logger.error(`request to dify api failed: ${error}`)
            throw new BadRequestException(
                `generate blueprint failed, please try again or provide your ip assets and fan scale in prompt`,
            )
        }
    }
}
