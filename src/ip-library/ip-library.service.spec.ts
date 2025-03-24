import { Test, TestingModule } from "@nestjs/testing"
import { IpLibraryService } from "./ip-library.service"

describe("IpLibraryService", () => {
    let service: IpLibraryService

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [IpLibraryService],
        }).compile()

        service = module.get<IpLibraryService>(IpLibraryService)
    })

    it("should be defined", () => {
        expect(service).toBeDefined()
    })
})
