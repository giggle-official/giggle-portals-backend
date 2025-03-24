import { Test, TestingModule } from '@nestjs/testing';
import { FaceSwapController } from './face-swap.controller';

describe('FaceSwapController', () => {
  let controller: FaceSwapController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FaceSwapController],
    }).compile();

    controller = module.get<FaceSwapController>(FaceSwapController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
