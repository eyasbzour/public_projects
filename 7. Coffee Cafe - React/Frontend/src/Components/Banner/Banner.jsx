import React,{Component} from 'react';

import BannerImg from "../../assets/coffee-white.png";
import BgTexture from "../../assets/website/coffee-texture.jpg";
import { GrSecure } from "react-icons/gr";
import { IoFastFood } from "react-icons/io5";
import { GiFoodTruck } from "react-icons/gi";


const bgImage ={
    backgroundImage: `url(${BgTexture})`,
    backgroundSize: "cover",
    backgroundColor:"#270c03",
    backgroundPosition: "center",
    backgroundRepeat: "no-repeat",
    height:"100%",
    width: "100%",
};
class Banner extends Component{
    render(){
        return (
            <div  id='about' className="banner" style={bgImage}>
                <div className="container min-h-[550px] flex justify-center items-center py-12 sm:py-0">
                    <div className="row">
                        <div className="col-md-12">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                                {/* image Section */}
                                <div data-aos='zoom-in'>
                                    <img src={BannerImg} alt="image"
                                    className='max-w-[430px] w-full mx-auto animate-slow-spin
                                    drop-shadow-xl]
                                    '
                                    />
                                </div>
                                {/* text content section */}
                                <div className='flex flex-col justify-center gap-6 sm:pt-0'>
                                    <h1  data-aos='fade-up' 
                                    className="text-3xl sm:text-4xl font-cursive font-bold text-gray-800 text-center sm:text-left">
                                         Premuim Coffee Blend
                                    </h1>
                                    <p  data-aos='fade-up'
                                        className='text-sm text-gray-500 tracking-wide leading-5'>
                                            Lorem ipsum dolor sit amet, consectetur adipiscing elit. 
                                            Mauris velit tortor, finibus et lorem non, 
                                            tempus maximus magna. Suspendisse interdum lorem et ornare.
                                            bibendum, Aenean commodo eget elit. 
                                    </p>
                                    <div className='grid grid-cols-2 gap-6'>
                                        <div className='space-y-5'>
                                            <div    data-aos='fade-up' data-aos-delay='100'
                                                    className='flex items-center gap-3'>
                                                <GrSecure
                                                    className='text-2xl h-12 w-12 drop-shadow-sm  p-3 rounded-full bg-amber-50'
                                                />
                                                <span>Premuim Coffee</span>
                                            </div>
                                            <div    data-aos='fade-up' data-aos-delay='300'
                                                    className='flex items-center gap-3'>
                                                <IoFastFood
                                                    className='text-2xl h-12 w-12 drop-shadow-sm p-3 rounded-full bg-red-100'
                                                />
                                                <span>Hot Coffee</span>
                                            </div>
                                            <div    data-aos='fade-up' data-aos-delay='500' data-aos-offset='0'
                                                    className='flex items-center gap-3'>
                                                <GiFoodTruck
                                                    className='text-2xl h-12 w-12 drop-shadow-sm p-3 rounded-full bg-teal-50'
                                                />
                                                <span>Cold Coffee</span>
                                            </div>
                                        </div>
                                        <div data-aos='slide-left'
                                            className='space-y-3 border-l-4 border-primary/50 pl-6'>
                                                <h1 className='text-2xl font-semibold font-cursive'>Tea Lover</h1>
                                                <p className='text-gray-500 text-sm'>
                                                    Much like evrything in life, brewing the perfect cup of tea
                                                    requires patience, percision, and a dash of passtion to create
                                                    a comforting blend of flavors.
                                                </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            
        )
    }
}
export default Banner;