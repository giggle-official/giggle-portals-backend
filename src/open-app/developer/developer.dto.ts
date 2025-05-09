import {
    IsNotEmpty,
    IsBoolean,
    IsOptional,
    IsArray,
    IsString,
    IsUrl,
    IsEmail,
    Matches,
    MaxLength,
    ArrayMaxSize,
} from "class-validator"
import { ApiProperty } from "@nestjs/swagger"
export class DeveloperWidgetCreateDto {
    @ApiProperty({
        description: "The name of the widget",
        example: "My Widget",
    })
    @IsNotEmpty()
    @IsString()
    @Matches(/^[a-zA-Z0-9\s]+$/, {
        message: "The name must contain only letters, numbers and spaces",
    })
    @MaxLength(100, {
        message: "The name must be less than 100 characters",
    })
    name: string

    @ApiProperty({
        description: "The summary of the widget",
        example: "This is a widget",
    })
    @IsNotEmpty()
    @IsString()
    summary: string

    @ApiProperty({
        description: "The description of the widget",
        example: "This is a widget",
    })
    @IsOptional()
    description: string

    @ApiProperty({
        description: "The category of the widget",
        example: "My Widget",
    })
    @IsNotEmpty()
    @IsString()
    category: string

    @ApiProperty({
        description: "The URL of the widget",
        example: "http://localhost:4290/create",
    })
    @IsNotEmpty()
    @IsUrl({
        protocols: ["http", "https"],
        require_protocol: true,
        require_tld: false,
    })
    widget_url: string

    @ApiProperty({
        description: "The URL of the widget management",
        example: "http://localhost:4290/management",
    })
    @IsNotEmpty()
    @IsUrl({
        protocols: ["http", "https"],
        require_protocol: true,
        require_tld: false,
    })
    management_url: string

    @ApiProperty({
        description: "The URL of the widget demo",
        example: "http://localhost:4290/demo",
    })
    @IsOptional()
    @IsUrl({
        protocols: ["http", "https"],
        require_protocol: true,
        require_tld: false,
    })
    demo_url: string

    @ApiProperty({
        description: "The URL of the widget repository",
        example: "https://github.com/my-widget",
    })
    @IsOptional()
    @IsUrl(
        {
            protocols: ["https"],
            require_protocol: true,
            require_tld: false,
        },
        {
            message: "The repository URL must be a valid URL and start with https",
        },
    )
    repository_url: string

    @ApiProperty({
        description: "Whether the widget is private",
        example: false,
    })
    @IsNotEmpty()
    @IsBoolean()
    is_private: boolean

    @ApiProperty({
        description: "The test users of the widget, max 10 users",
        example: ["test1@giggle.pro", "test2@giggle.pro"],
    })
    @IsOptional()
    @IsArray()
    @IsEmail({}, { each: true })
    @ArrayMaxSize(10)
    test_users: string[]
}

export class DeveloperWidgetUpdateDto extends DeveloperWidgetCreateDto {
    @ApiProperty({
        description: "The tag of the widget",
        example: "my-widget",
    })
    @IsNotEmpty()
    @IsString()
    tag: string
}

export class DeveloperWidgetDeleteDto {
    @IsNotEmpty()
    @IsString()
    tag: string
}

export class DeveloperWidgetDeleteResponseDto {
    @ApiProperty({
        description: "The status of the widget deletion",
        example: "success",
    })
    status: string
}

export class WidgetIdentityDto {
    @ApiProperty({
        description: "The access key of the widget",
        example: "1234567890",
    })
    access_key: string

    @ApiProperty({
        description: "The secret key of the widget",
        example: "1234567890",
    })
    secret_key: string
}
