import { Controller, Req, Post, Body, Param, UseGuards, Get, Query, HttpStatus, HttpCode } from "@nestjs/common"
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger"
import { AuthGuard } from "@nestjs/passport"
import { AnnouncementService } from "./announcement.service"
import {
    CreateAnnouncementDto,
    AnnouncementDetailDto,
    AnnouncementListDto,
    AnnouncementListQueryDto,
    UpdateAnnouncementDto,
    DeleteAnnouncementResponseDto,
    DeleteAnnouncementDto,
} from "./announcement.dto"
import { UserInfoDTO } from "src/user/user.controller"
import { Request } from "express"

@Controller("/api/v1/ip/announcement")
@ApiTags("Announcement")
export class AnnouncementController {
    constructor(private readonly announcementService: AnnouncementService) {}

    @Post()
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Create an announcement" })
    @ApiResponse({ type: AnnouncementDetailDto, status: 200 })
    async create(@Req() req: Request, @Body() createAnnouncementDto: CreateAnnouncementDto) {
        return this.announcementService.create(req.user as UserInfoDTO, createAnnouncementDto)
    }

    @Get("/")
    @ApiOperation({ summary: "Get announcement list" })
    @ApiResponse({ type: AnnouncementListDto, status: 200 })
    async listAnnouncements(@Query() query: AnnouncementListQueryDto) {
        return await this.announcementService.list(query)
    }

    @Get("/detail/:id")
    @ApiOperation({ summary: "Get announcement detail" })
    @ApiResponse({ type: AnnouncementDetailDto, status: 200 })
    async detail(@Param("id") id: string) {
        return await this.announcementService.getAnnouncementDetail(parseInt(id))
    }

    @Get("/:ipId")
    @ApiOperation({ summary: "Get announcement list by ip" })
    @ApiResponse({ type: AnnouncementListDto, status: 200 })
    async listIpAnnouncements(@Query() query: AnnouncementListQueryDto, @Param("ipId") ipId: string) {
        return await this.announcementService.listAnnouncements(parseInt(ipId), query)
    }

    @Post("/update")
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiBody({ type: UpdateAnnouncementDto })
    @ApiOperation({ summary: "Update an announcement" })
    @ApiResponse({ type: AnnouncementDetailDto, status: 200 })
    async update(@Req() req: Request, @Body() updateAnnouncementDto: UpdateAnnouncementDto) {
        return this.announcementService.update(req.user as UserInfoDTO, updateAnnouncementDto)
    }

    @Post("/delete")
    @UseGuards(AuthGuard("jwt"))
    @ApiBearerAuth()
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: "Delete an announcement" })
    @ApiBody({ type: DeleteAnnouncementDto })
    @ApiResponse({ type: DeleteAnnouncementResponseDto, status: 200 })
    async delete(@Req() req: Request, @Body() deleteAnnouncementDto: DeleteAnnouncementDto) {
        return this.announcementService.delete(req.user as UserInfoDTO, deleteAnnouncementDto)
    }
}
