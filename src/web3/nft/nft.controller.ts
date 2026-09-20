import { Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common"
import { MyNftListResDto, MyNftReqDto } from "./nft.dto"
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
        summary: "Mint a nft from an asset (retired)",
        description: "NFT minting has been retired. This endpoint always responds 503.",
        deprecated: true,
    })
    @ApiBearerAuth()
    @ApiResponse({ status: 503, description: "NFT minting is no longer available" })
    @UseGuards(AuthGuard("jwt"))
    async mint() {
        return await this.nftService.mintNft()
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
