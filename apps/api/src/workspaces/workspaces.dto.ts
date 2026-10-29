import { Prisma, Role } from "@prisma/client";
import {
  IsEmail,
  IsEnum,
  IsHexColor,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from "class-validator";

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

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  name!: string;

  @IsOptional()
  @IsHexColor()
  color?: string;
}

export class CreateFilterDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsObject()
  state!: Prisma.InputJsonObject;
}

export class UpdateFilterDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name?: string;

  @IsOptional()
  @IsObject()
  state?: Prisma.InputJsonObject;
}
