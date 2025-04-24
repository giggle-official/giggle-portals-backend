import { Test, TestingModule } from '@nestjs/testing';
import { RewardsPoolController } from './rewards-pool.controller';

describe('RewardsPoolController', () => {
  let controller: RewardsPoolController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [RewardsPoolController],
    }).compile();

    controller = module.get<RewardsPoolController>(RewardsPoolController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
