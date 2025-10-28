import { NestFactory, Reflector } from "@nestjs/core"
import { AppModule } from "./app.module"
import { TransformInterceptor } from "./common/response.interceptor"
import { ValidationPipe } from "@nestjs/common"
import { HttpExceptionFilter } from "./common/http-expection.filter"
import cookieParser from "cookie-parser"
import session from "express-session"
import { SwaggerModule } from "@nestjs/swagger"
import { DocumentBuilder } from "@nestjs/swagger"
import { PrismaService } from "./common/prisma.service"
import { LogsService } from "./user/logs/logs.service"
import { useContainer } from "class-validator"
import { apiReference } from "@scalar/nestjs-api-reference"
import path from "path"
import fs from "fs"

declare module "express-session" {
    interface Session {
        redirectUrl?: string
        state?: string
    }
}

async function bootstrap() {
    const app = await NestFactory.create(AppModule, { rawBody: true })
    app.useGlobalInterceptors(new TransformInterceptor(new Reflector(), new LogsService(new PrismaService())))
    app.useGlobalFilters(
        new HttpExceptionFilter(new TransformInterceptor(new Reflector(), new LogsService(new PrismaService()))),
    )
    app.use(cookieParser(process.env.SESSION_SECRET))
    useContainer(app.select(AppModule), { fallbackOnErrors: true })
    app.useGlobalPipes(new ValidationPipe())
    app.use(
        session({
            secret: process.env.SESSION_SECRET || "somesessionsecret",
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: 3600000, // 1 hour
                httpOnly: true,
                secure: process.env.ENV === "product", // Use secure cookies in production
            },
        }),
    )
    app.enableCors({
        origin: true,
        credentials: true,
    })

    const config = new DocumentBuilder()
        .setTitle("Giggle.Pro API Reference")
        .setDescription("This is the API reference for Giggle.Pro")
        .setVersion("1.0")
        .addTag(
            "Summary",
            "This API provides endpoints for managing IP libraries, including creation, retrieval, and validation of IP data.",
        )
        .addBearerAuth({
            type: "http",
            bearerFormat: "JWT",
            in: "header",
            name: "Authorization",
            description: "JWT Authorization",
        })
        .setOpenAPIVersion("3.1.1")
        .build()

    const publicConfig = new DocumentBuilder()
        .setTitle("Giggle.Pro Developer API Reference")
        .setDescription(
            `
# Introduction

The Giggle API provides essential services for digital identity and financial management for widget developers and all personal users to create their own IP libraries:

- **IP Management**: IP library management, including creation, retrieval, and interaction with IP data
- **Account Management**: User login, profile management, and activity tracking, following/unfollowing other users
- **Wallet Functions**: Secure digital wallet management, balance query, and send/receive tokens
- **Payment Processing(coming soon)**: Support user wallet payment with secure transaction handling

---

# Authentication

Most protected endpoints require a valid JWT token in the Authorization header. 
Public endpoints can be accessed without authentication. Each endpoint in the documentation is clearly marked to indicate whether authentication is required. To obtain a JWT token for accessing protected endpoints, please refer to our authentication widget documentation at [Widget Authentication](https://docs.giggle.pro/widget-development/authentication-and-security). The widget provides a streamlined authentication flow that handles token generation, refresh, and secure storage for your application.

---

# Response Format

Most responses are in JSON format, the main schema is as follows:

\`\`\`json
{
    "code": 200,
    "msg": "some message",
    "data": {}
}
 \`\`\`

---

# Error Response

If request fails, api will will return http error code and the error response in the following format:

\`\`\`json
{
    "code": 400,
    "msg": "this is an error message",
    "data": {}
}
 \`\`\`

error codes examples:

- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

---

# Event Stream Response

Some endpoints return event stream response (SSE),   the response will be in the following format:

\`\`\`json
{
    "event": "some event",
    "data": {}
}
\`\`\`

This approach is particularly used for long-running operations such as IP creation, token publishing, and other time-intensive processes that require real-time progress updates to the client.

To see how to process the event stream response, please refer to the [Event Stream](https://docs.giggle.pro/widget-development/event-stream-response) documentation.

---
`,
        )
        .addServer("https://api.giggle.pro", "Production Environment")
        .addServer("https://app.ggltest.com", "Test Environment")
        .addServer("https://api-dev.ggltest.com", "Development Environment")
        .addBearerAuth({
            type: "http",
            bearerFormat: "JWT",
            in: "header",
            name: "Authorization",
            description: "JWT Authorization",
        })

        .build()
    const privateDocument = SwaggerModule.createDocument(app, config)
    const publicDocument = SwaggerModule.createDocument(app, publicConfig)

    publicDocument["x-tagGroups"] = [
        {
            name: "Apps",
            tags: ["IP Portal", "Widgets"],
        },
        {
            name: "IP Management",
            tags: ["IP Library", "Announcement", "Comments", "Link", "Market Maker"],
        },
        {
            name: "Rewards Pool",
            tags: ["Rewards Pool"],
        },
        {
            name: "Account",
            tags: ["Profile", "User Wallet", "Assets"],
        },
        {
            name: "Payment",
            tags: ["Order", "Credit"],
        },
        {
            name: "Web3",
            tags: ["IP Tokens", "Web3 Tools", "Nfts"],
        },
        {
            name: "Developer Utility",
            tags: ["Developer Utility"],
        },
    ]

    privateDocument["x-tagGroups"] = [
        {
            name: "📚 IP Management",
            tags: ["IP Library", "IP Order", "Announcement", "Comments", "Link"],
        },
        {
            name: "🧑‍💼 Account",
            tags: ["Profile", "Auth", "User Wallet", "Assets"],
        },
        {
            name: "💰 Payment",
            tags: ["Order", "Credit"],
        },
        {
            name: "🌐 Web3",
            tags: ["IP Tokens", "Web3 Tools", "Nfts"],
        },
        {
            name: "🏠 Portals",
            tags: ["IP Portal"],
        },
        {
            name: "🧩 Widgets",
            tags: ["Widgets"],
        },
        {
            name: "🔑 Admin",
            tags: [
                "App Management",
                "Widgets Management",
                "Rewards Pool Management",
                "Order Management",
                "Test Tools",
                "Developer Utility",
                "Launch Agent",
                "Sales Agent",
                "Market Maker Management",
                "Credit2c Management",
            ],
        },
    ]

    if (process.env.ENV === "local") {
        publicDocument.servers.push({
            url: "https://app.local.giggle.pro",
            description: "Local Environment",
        })
        publicDocument.servers.push({
            url: "https://app.ggltest.com",
            description: "Development Environment",
        })
    }

    app.use("/api/reference", (req, res, next) => {
        if (req.path === "/" || req.path === "") {
            const FRONTEND_URL = process.env.FRONTEND_URL
            return res.redirect(301, `${FRONTEND_URL}/developer/api-reference`)
        }
        next()
    })

    app.use(
        "/api/reference-private",
        apiReference({
            spec: {
                content: privateDocument,
            },
            hideClientButton: true,
            hideModels: true,
            hideDownloadButton: true,
        }),
    )

    //app.use(
    //    "/api/reference",
    //    apiReference({
    //        spec: {
    //            content: publicDocument,
    //        },
    //        hideClientButton: true,
    //        hideModels: true,
    //        hideDownloadButton: true,
    //        favicon: "https://app.giggle.pro/favicon.svg",
    //        metaData: {
    //            title: "Giggle.Pro Developer API Reference",
    //            description: "This is the API reference for Giggle.Pro",
    //            keywords: "Giggle.Pro, API, Reference, Developer, Documentation",
    //            author: "Giggle.Pro",
    //            ogImage: "https://app.giggle.pro/images/open-app/og-image.jpg",
    //        },
    //    }),
    //)

    //const privateOutputPath = path.join(process.cwd(), "openapi-private-spec.json")
    //fs.writeFileSync(privateOutputPath, JSON.stringify(privateDocument, null, 2))
    //
    if (process.env.ENV === "local") {
        const publicOutputPath = path.join(process.cwd(), "src/docs/openapi-public-spec.json")
        fs.writeFileSync(publicOutputPath, JSON.stringify(publicDocument, null, 2))
    }

    await app.listen(process.env.RUN_PORT || 3000, "0.0.0.0")
}
bootstrap()
