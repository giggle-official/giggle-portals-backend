import { Test, TestingModule } from "@nestjs/testing"
import { CreditsService } from "./users.service"

describe("CreditsService", () => {
    let service: CreditsService

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [CreditsService],
        }).compile()

        service = module.get<CreditsService>(CreditsService)
    })

    it("should be defined", () => {
        expect(service).toBeDefined()
    })
})
