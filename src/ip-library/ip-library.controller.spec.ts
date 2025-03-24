import { Test, TestingModule } from '@nestjs/testing';
import { IpLibraryController } from './ip-library.controller';

describe('IpLibraryController', () => {
  let controller: IpLibraryController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [IpLibraryController],
    }).compile();

    controller = module.get<IpLibraryController>(IpLibraryController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
