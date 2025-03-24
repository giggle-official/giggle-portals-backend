import { Test, TestingModule } from '@nestjs/testing';
import { VideoToVideoController } from './video-to-video.controller';

describe('VideoToVideoController', () => {
  let controller: VideoToVideoController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [VideoToVideoController],
    }).compile();

    controller = module.get<VideoToVideoController>(VideoToVideoController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
