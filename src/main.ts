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
        .setTitle("3 Body Labs API Reference")
        .setDescription("This is the API reference for 3 Body Labs")
        .setVersion("1.0")
        .addTag(
            "Summary",
            "This API provides endpoints for managing IP libraries, including creation, retrieval, and validation of IP data.",
        )
        .addTag("Key Concepts", "IP Library, Validation, Authentication, SSE, Swagger Documentation")
        .addBearerAuth({
            type: "http",
            bearerFormat: "JWT",
            in: "header",
            name: "Authorization",
            description: "JWT Authorization",
        })
        .setOpenAPIVersion("3.1.1")
        .build()
    const document = SwaggerModule.createDocument(app, config)
    document["x-tagGroups"] = [
        {
            name: "📚 IP Management",
            tags: ["IP Library", "License", "Announcement", "Comments"],
        },
        {
            name: "🔨 AIGC Tools",
            tags: ["AIGC Video Animation", "AIGC Face Swap", "AIGC Video Generator", "AIGC Image Generator"],
        },
        {
            name: "🖼️ Assets",
            tags: ["Assets"],
        },
        {
            name: "🧑‍💼 Account",
            tags: ["Account", "Auth"],
        },
        {
            name: "🌐 Web3",
            tags: ["Web3 Giggle", "Web3 Tools"],
        },
        {
            name: "🧩 Open App",
            tags: ["Open App"],
        },
    ]

    app.use(
        "/api/reference",
        apiReference({
            spec: {
                content: document,
            },
            hideClientButton: true,
            hideModels: true,
            hideDownloadButton: true,
        }),
    )
    SwaggerModule.setup("/api/docs", app, document)

    await app.listen(process.env.RUN_PORT || 3000, "0.0.0.0")
}
bootstrap()
