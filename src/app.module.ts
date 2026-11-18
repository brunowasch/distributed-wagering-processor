import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { ReflectMetadataProvider } from '@mikro-orm/decorators/legacy';
import { WageringModule } from './wagering/wagering.module.js';

@Module({
  imports: [
    // Carrega .env de forma global
    ConfigModule.forRoot({
      isGlobal: true, 
    }),

    // Integra o MikroORM ao NestJS
    MikroOrmModule.forRootAsync({
      driver: PostgreSqlDriver, // Declara o driver para a configuração assíncrona.
      inject: [ConfigService],
      useFactory: (configService : ConfigService) => ({
        driver: PostgreSqlDriver,
        host: configService.get<string>('DATABASE_HOST'),
        port: Number(configService.get<string>('DATABASE_PORT')),
        dbName: configService.get<string>('DATABASE_NAME'),
        user: configService.get<string>('DATABASE_USER'),
        password: configService.get<string>('DATABASE_PASSWORD'),
        autoLoadEntities: true, // Registra auomaticamente as entidades adicionadas aos módulos
        metadataProvider: ReflectMetadataProvider,
        discovery: {
          warnWhenNoEntities: false,
        },
      }),
    }),
    
    WageringModule,

  ],
})
export class AppModule {}
