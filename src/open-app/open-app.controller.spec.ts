import { Test, TestingModule } from '@nestjs/testing';
import { OpenAppController } from './open-app.controller';

describe('OpenAppController', () => {
  let controller: OpenAppController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [OpenAppController],
    }).compile();

    controller = module.get<OpenAppController>(OpenAppController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
