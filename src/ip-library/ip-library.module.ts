import { forwardRef, Module } from "@nestjs/common"
import { IpLibraryController } from "./ip-library.controller"
import { IpLibraryService } from "./ip-library.service"
import { PrismaService } from "src/common/prisma.service"
import { UtilitiesService } from "src/common/utilities.service"
import { AssetsModule } from "src/assets/assets.module"
import { UniversalStimulatorModule } from "src/universal-stimulator/universal-stimulator.module"
import { UserModule } from "src/user/user.module"
import { CreditModule } from "src/credit/credit.module"
import { Web3Module } from "src/web3/web3.module"
import { LicenseService } from "./license/license.service"
import { LicenseController } from "./license/license.controller"
import { IpNameValidator } from "./ip-library.validator"
import { AnnouncementController } from './announcement/announcement.controller';
import { AnnouncementService } from './announcement/announcement.service';
import { CommentsController } from './comments/comments.controller';
import { CommentsService } from './comments/comments.service';

@Module({
    imports: [
        forwardRef(() => AssetsModule),
        forwardRef(() => UniversalStimulatorModule),
        forwardRef(() => UserModule),
        forwardRef(() => CreditModule),
        forwardRef(() => Web3Module),
    ],
    controllers: [IpLibraryController, LicenseController, AnnouncementController, CommentsController],
    providers: [IpLibraryService, PrismaService, UtilitiesService, LicenseService, IpNameValidator, AnnouncementService, CommentsService],
    exports: [IpLibraryService, LicenseService],
})
export class IpLibraryModule {}
