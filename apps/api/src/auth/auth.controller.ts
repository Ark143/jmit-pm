import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { AuthUser } from "./auth.types";
import { LoginDto, RegisterDto } from "./auth.dto";
import { AuthService } from "./auth.service";
import { CurrentUser, JwtAuthGuard } from "./jwt-auth.guard";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Post("login")
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.userId);
  }
}
