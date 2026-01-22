import { Controller, HttpStatus, HttpCode, Req, Get, Query, UseGuards, Post, Body, Param } from "@nestjs/common"
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AssetsService } from "./assets.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    AssetsListResDto,
    AssetListReqDto,
    AssetRenameReqDto,
    AssetsDto,
    GetPresignedUploadUrlReqDto,
    GetPresignedUploadUrlResDto,
    RegisterAssetDto,
    DeleteAssetDto,
    AssetDetailDto,
} from "./assets.dto"
import { Request } from "express"
import { AuthGuard } from "@nestjs/passport"

@ApiTags("Assets")
@ApiBearerAuth()
@Controller("/api/v1/assets")
export class AssetsController {
    constructor(private readonly assetsService: AssetsService) { }

    @Get("/")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: AssetsListResDto })
    @ApiOperation({ summary: "Retrieve all assets" })
    async getAssets(@Req() req: Request, @Query() query: AssetListReqDto) {
        return await this.assetsService.getAssets(req.user as UserJwtExtractDto, query)
    }

    @Get("/:id")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiParam({ name: "id", description: "asset id" })
    @ApiResponse({ type: AssetDetailDto })
    @ApiOperation({ summary: "Retrieve an asset detail" })
    async getAsset(@Req() req: Request, @Param("id") id: string) {
        return await this.assetsService.getAsset(req.user as UserJwtExtractDto, id.toString())
    }

    @Post("/rename")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: AssetsDto })
    @ApiOperation({ summary: "Rename an asset" })
    async renameAsset(@Req() req: Request, @Body() body: AssetRenameReqDto) {
        return await this.assetsService.renameAsset(req.user as UserJwtExtractDto, body)
    }

    @Post("/get-presigned-url")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: GetPresignedUploadUrlResDto })
    @ApiOperation({
        summary: "Retrieve a presigned url",
        description:
            "Retrieve a presigned url for asset upload, you need use PUT method to upload the asset via returned url",
    })
    async uploadToken(@Req() req: Request, @Body() body: GetPresignedUploadUrlReqDto) {
        return await this.assetsService.getPresignedUploadUrl(req.user as any, body)
    }

    @Post("/register")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiBody({ type: RegisterAssetDto })
    @ApiResponse({ type: AssetDetailDto })
    @ApiOperation({
        summary: "Register an asset",
        description: "Register a s3 key to asset after asset was uploaded",
    })
    async registerAsset(@Req() req: Request, @Body() body: RegisterAssetDto) {
        return await this.assetsService.registerAsset(req.user as any, body)
    }

    @Post("/delete")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Delete an asset" })
    async deleteAsset(@Req() req: Request, @Body() body: DeleteAssetDto) {
        return await this.assetsService.deleteAsset(req.user as UserJwtExtractDto, body.asset_id)
    }
}
