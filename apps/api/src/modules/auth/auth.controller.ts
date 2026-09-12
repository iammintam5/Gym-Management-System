import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotImplementedException,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '@gym/contracts';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LoginDto, RefreshTokenDto } from './dto/login.dto';
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiResponse({
    status: 501,
    description: 'Credential verification is not implemented.',
  })
  login(@Body() _body: LoginDto): never {
    throw new NotImplementedException(
      'Login is not implemented in this foundation.',
    );
  }
  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiResponse({
    status: 501,
    description: 'Refresh rotation and persistence are not implemented.',
  })
  refresh(@Body() _body: RefreshTokenDto): never {
    throw new NotImplementedException(
      'Refresh token rotation is not implemented.',
    );
  }
  @Get('me')
  @ApiBearerAuth()
  @ApiResponse({
    status: 200,
    description:
      'Verified access-token identity (no database profile lookup yet).',
  })
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }
}
