import { Injectable } from "@nestjs/common"
import { MailgunService } from "nestjs-mailgun"
import * as handlebars from "handlebars"
import * as fs from "fs"
import * as path from "path"

@Injectable()
export class NotificationService {
    constructor(private mailgunService: MailgunService) {}
    private readonly DEFAULT_DOMAIN = "mail.giggle.pro"
    private readonly DEFAULT_FROM = "Giggle.Pro <app-noreply@giggle.pro>"

    async sendNotification(
        subject: string,
        to: string,
        templateName: string,
        context: any,
        domain: string = this.DEFAULT_DOMAIN,
        from: string = this.DEFAULT_FROM,
    ) {
        const templatePath = path.join(__dirname, "template", `${templateName}.hbs`)
        const htmlTemplate = await this.readHTMLFile(templatePath)

        const template = handlebars.compile(htmlTemplate)
        return this.mailgunService.createEmail(domain, {
            from: from,
            to: to,
            subject: subject,
            html: template(context),
        })
    }

    async sendTextNotification(
        subject: string,
        to: string,
        text: string,
        domain: string = this.DEFAULT_DOMAIN,
        from: string = this.DEFAULT_FROM,
    ) {
        return this.mailgunService.createEmail(domain, {
            from: from,
            to: to,
            subject: subject,
            text: text,
        })
    }

    private readHTMLFile(path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            fs.readFile(path, { encoding: "utf-8" }, (err, html) => {
                if (err) {
                    reject(err)
                } else {
                    resolve(html)
                }
            })
        })
    }
}
