import {
    Controller,
    Get,
    Post,
    Query,
    Body,
    HttpStatus,
    HttpCode,
    Param,
    ParseIntPipe,
    ParseArrayPipe,
    Req,
    UseGuards,
} from "@nestjs/common"
import { AuthGuard } from "@nestjs/passport"
import { IpLibraryService } from "src/admin/ip-library/ip-library.service"
import { GetManyParams, ListParams, ListReferenceParams } from "../request.dto"
import { CheckPolicies } from "src/guards/policies.guard"
import {
    CreateIpLibraryDto,
    DeleteSignatureClipDto,
    UpdateIpLibraryDto,
    UpdateManyArrayDto,
    UploadSignatureClipsDto,
    UploadSignDto,
} from "src/ip-library/ip-library.dto"
import { ApiExcludeController } from "@nestjs/swagger"
import { Request } from "express"
import { UserInfoDTO } from "src/user/user.controller"

@ApiExcludeController()
@Controller("/api/v2/admin/ip-library")
export class IpLibraryController {
    constructor(private readonly ipLibraryService: IpLibraryService) {}

    @Get("/")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("read_ip_library"))
    async list(@Query() query: ListParams) {
        return this.ipLibraryService.list(query)
    }

    @Get("/signature-clips")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("read_ip_library"))
    async signatureClips(@Query() query: ListReferenceParams) {
        return this.ipLibraryService.signatureClips(query)
    }

    @Get("/signature-clips/:id")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("read_ip_library"))
    async signatureClip(@Param("id", ParseIntPipe) id: number) {
        return this.ipLibraryService.signatureClip(id)
    }

    @Post("/signature-clips/update")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async updateSignatureClip(
        @Req() req: Request,
        @Body() body: UpdateIpLibraryDto,
        @Body("id", ParseIntPipe) id: number,
    ) {
        return this.ipLibraryService.updateSignatureClip(req.user as UserInfoDTO, { ...body, id }, id)
    }

    @Get("/getMany")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("read_ip_library"))
    async getMany(@Query("ids", new ParseArrayPipe({ items: Number, separator: "," })) query: GetManyParams) {
        return this.ipLibraryService.getMany(query)
    }

    @Get("/:id")
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("read_ip_library"))
    async get(@Param("id", ParseIntPipe) id: number) {
        return this.ipLibraryService.detail(id)
    }

    @Post("/update")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async update(@Req() req: Request, @Body() body: UpdateIpLibraryDto, @Body("id", ParseIntPipe) id: number) {
        return this.ipLibraryService.update(req.user as UserInfoDTO, { ...body, id }, id)
    }

    @Post("/create")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async create(@Req() req: Request, @Body() body: CreateIpLibraryDto) {
        return this.ipLibraryService.create(req.user as UserInfoDTO, body)
    }

    @Post("/createMany")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async createMany(@Req() req: Request, @Body() body: CreateIpLibraryDto[]) {
        return this.ipLibraryService.createMany(req.user as UserInfoDTO, body)
    }

    @Post("/updateManyArray")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async updateManyArray(@Req() req: Request, @Body() body: UpdateManyArrayDto) {
        return this.ipLibraryService.updateManyArray(req.user as UserInfoDTO, body)
    }

    @Post("/getSignedUploadUrl")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async getSignedUploadUrl(@Body() body: UploadSignDto) {
        return this.ipLibraryService.signedUploadUrl(body)
    }

    @Post("/uploadSignatureClips")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async uploadSignatureClips(@Req() req: Request, @Body() body: UploadSignatureClipsDto) {
        return this.ipLibraryService.uploadSignatureClips(req.user as UserInfoDTO, body)
    }

    @Post("/deleteSignatureClip")
    @HttpCode(HttpStatus.OK)
    @UseGuards(AuthGuard("jwt"))
    @CheckPolicies((abilities) => abilities.can("manage_ip_library"))
    async deleteSignatureClip(@Req() req: Request, @Body() body: DeleteSignatureClipDto) {
        return await this.ipLibraryService.deleteSignatureClip(req.user as UserInfoDTO, body)
    }
}
