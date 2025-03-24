import { Test, TestingModule } from '@nestjs/testing';
import { FaceSwapService } from './face-swap.service';

describe('FaceSwapService', () => {
  let service: FaceSwapService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FaceSwapService],
    }).compile();

    service = module.get<FaceSwapService>(FaceSwapService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
