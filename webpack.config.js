const path = require('path');
const Dotenv = require('dotenv-webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const isDevelopment = argv.mode === 'development';
  const envPath = path.resolve(__dirname, isDevelopment ? '.env' : '.env.production');

  return {
    entry: path.resolve(__dirname, 'src/client/index.js'),
    output: {
      path: path.resolve(__dirname, 'public/dist'),
      filename: isDevelopment ? '[name].bundle.js' : '[name].[contenthash].js',
      // Production: assets must load from /dist/* when Express serves `public/` (see server.js SPA routes).
      publicPath: isDevelopment ? '/' : '/dist/',
      clean: true
    },
    module: {
      rules: [
        {
          test: /\.(js|jsx)$/,
          exclude: /node_modules/,
          use: {
            loader: 'babel-loader',
            options: {
              presets: ['@babel/preset-env', '@babel/preset-react']
            }
          }
        },
        {
          test: /\.css$/,
          use: ['style-loader', 'css-loader']
        },
        {
          test: /\.(png|svg|jpg|jpeg|gif)$/i,
          type: 'asset/resource'
        }
      ]
    },
    resolve: {
      extensions: ['.js', '.jsx']
    },
    plugins: [
      new Dotenv({
        path: envPath,
        systemvars: true,
        silent: true
      }),
      new HtmlWebpackPlugin({
        // Keep template in src so it's tracked in git (public/ is ignored).
        template: path.resolve(__dirname, 'src/client/index.template.html'),
        filename: 'index.html',
        inject: true
      })
    ],
    devtool: isDevelopment ? 'eval-source-map' : 'source-map',
    devServer: {
      static: {
        directory: path.join(__dirname, 'public')
      },
      port: 3001,
      hot: true,
      historyApiFallback: true,
      proxy: [
        {
          context: ['/api'],
          target: 'http://localhost:3000',
          proxyTimeout: 180000,
          timeout: 180000
        },
        {
          context: ['/uploads'],
          target: 'http://localhost:3000',
          changeOrigin: true
        }
      ],
      client: {
        overlay: true,
        progress: true
      },
      setupMiddlewares: (middlewares, devServer) => {
        if (!devServer) {
          throw new Error('webpack-dev-server is not defined');
        }
        return middlewares;
      }
    },
    optimization: {
      splitChunks: {
        chunks: 'all'
      }
    }
  };
}; 