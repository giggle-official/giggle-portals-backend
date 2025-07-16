import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common"
import { MintNftReqDto, MyNftListResDto, MyNftReqDto, NftDetailResDto } from "./nft.dto"
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { NftService } from "./nft.service"
import { AuthGuard } from "@nestjs/passport"
import { Request } from "express"
import { UserJwtExtractDto } from "src/user/user.controller"

@Controller("/api/v1/nft")
@ApiTags("Nfts")
export class NftController {
    constructor(private readonly nftService: NftService) {}

    @Post("/mint")
    @ApiOperation({
        summary: "Mint a nft from an asset",
        description:
            "Mint a nft from an asset, you must use our asset service to upload the asset first, this api will create a task id, you can use the task id to retrieve the nft minting status",
    })
    @ApiBearerAuth()
    @ApiResponse({ type: NftDetailResDto })
    @UseGuards(AuthGuard("jwt"))
    async mint(@Req() req: Request, @Body() body: MintNftReqDto) {
        return await this.nftService.mintNft(req.user as UserJwtExtractDto, body)
    }

    @Get("/my")
    @ApiOperation({
        summary: "Retrieve users nfts",
        description: "Retrieve users nfts list",
    })
    @ApiResponse({ type: MyNftListResDto })
    @UseGuards(AuthGuard("jwt"))
    async getMyNfts(@Req() req: Request, @Query() query: MyNftReqDto) {
        return await this.nftService.getMyNfts(req.user as UserJwtExtractDto, query)
    }
}
