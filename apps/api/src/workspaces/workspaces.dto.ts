import { IsEnum, IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Role } from "@prisma/client";

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;
}

export class AddMemberDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsEnum(Role)
  role?: Role;
}
