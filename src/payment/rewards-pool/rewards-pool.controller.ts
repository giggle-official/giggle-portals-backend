import { Controller, Get, Post, Body, Param } from "@nestjs/common"
import { AppendTokenDto, CreateRewardsPoolDto, UpdateRewardsPoolDto } from "./rewards-pool.dto"
@Controller("/api/v1/rewards-pool")
export class RewardsPoolController {
    @Post("/create")
    async createPool(@Body() body: CreateRewardsPoolDto) {
        // TODO: Implement the logic to create a new rewards pool
        // return this.rewardsPoolService.createPool(body)
    }
    @Post("/update")
    async updatePool(@Body() body: UpdateRewardsPoolDto) {
        // TODO: Implement the logic to update a rewards pool
        // return this.rewardsPoolService.updatePool(body)
    }
    @Post("/append-token")
    async appendToken(@Body() body: AppendTokenDto) {
        // TODO: Implement the logic to append a token to a rewards pool
        // return this.rewardsPoolService.appendToken(body)
    }
    @Get("/")
    async getPools() {
        // TODO: Implement the logic to get all rewards pools
        // return this.rewardsPoolService.getPools()
    }
    @Get("/:mint_address")
    async getPoolByMintAddress(@Param("mint_address") mint_address: string) {
        // TODO: Implement the logic to get a rewards pool by mint address
        // return this.rewardsPoolService.getPoolByMintAddress(mint_address)
    }
}
