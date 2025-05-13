import { Controller, HttpStatus, HttpCode, Req, Get, Query, UseGuards, Post, Body, Param } from "@nestjs/common"
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOperation, ApiParam, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AssetsService } from "./assets.service"
import { UserJwtExtractDto } from "src/user/user.controller"
import {
    AssetsListResDto,
    AssetListReqDto,
    AssetRenameReqDto,
    AssetsDto,
    UploadTokenDto,
    UploadTokenResDto,
    UploadedDto,
    DeleteAssetDto,
    AssetDetailDto,
    RelateToIpDto,
} from "./assets.dto"
import { Request } from "express"
import { AuthGuard } from "@nestjs/passport"

@ApiTags("Assets")
@ApiBearerAuth()
@Controller("/api/v1/assets")
export class AssetsController {
    constructor(private readonly assetsService: AssetsService) {}

    @Get("/")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: AssetsListResDto })
    @ApiOperation({ summary: "Get all assets" })
    async getAssets(@Req() req: Request, @Query() query: AssetListReqDto) {
        return await this.assetsService.getAssets(req.user as UserJwtExtractDto, query)
    }

    @Get("/:id")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiParam({ name: "id", description: "asset id" })
    @ApiResponse({ type: AssetDetailDto })
    @ApiOperation({ summary: "Get an asset" })
    async getAsset(@Req() req: Request, @Param("id") id: string) {
        return await this.assetsService.getAsset(req.user as UserJwtExtractDto, parseInt(id))
    }

    @Post("/rename")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @ApiResponse({ type: AssetsDto })
    @ApiOperation({ summary: "Rename an asset" })
    async renameAsset(@Req() req: Request, @Body() body: AssetRenameReqDto) {
        return await this.assetsService.renameAsset(req.user as UserJwtExtractDto, body)
    }

    @Post("uploadToken")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: UploadTokenResDto })
    @ApiOperation({
        summary: "Get an upload link",
        description: "Get a upload token for s3 upload",
    })
    async uploadToken(@Req() req: Request, @Body() body: UploadTokenDto) {
        return await this.assetsService.uploadToken(req.user as any, body)
    }

    @Post("uploaded")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiResponse({ type: UploadedDto })
    @ApiOperation({
        summary: "Register an asset",
        description: "Call when assets was uploaded, to register the asset info",
    })
    async uploaded(@Req() req: Request, @Body() body: UploadedDto) {
        return await this.assetsService.uploaded(req.user as any, body)
    }

    @Post("/delete")
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Delete an asset" })
    async deleteAsset(@Req() req: Request, @Body() body: DeleteAssetDto) {
        return await this.assetsService.deleteAsset(req.user as UserJwtExtractDto, body.asset_id)
    }
}
