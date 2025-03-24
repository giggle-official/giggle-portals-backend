import { Test, TestingModule } from '@nestjs/testing';
import { OpenAppService } from './open-app.service';

describe('OpenAppService', () => {
  let service: OpenAppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenAppService],
    }).compile();

    service = module.get<OpenAppService>(OpenAppService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
