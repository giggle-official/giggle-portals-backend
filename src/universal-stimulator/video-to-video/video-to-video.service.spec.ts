import { Test, TestingModule } from '@nestjs/testing';
import { VideoToVideoService } from './video-to-video.service';

describe('VideoToVideoService', () => {
  let service: VideoToVideoService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [VideoToVideoService],
    }).compile();

    service = module.get<VideoToVideoService>(VideoToVideoService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
